import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import {
  ArchiveAnalyzer,
  inferArchiveType,
  validateArchiveEntries,
  validateArchiveEntryPath,
} from '../src/analysis/archiveAnalyzer.js';
import { MAX_REPORT_FILE_ENTRIES } from '../src/config.js';

const execFileAsync = promisify(execFile);

test('infers supported archive types for analysis', () => {
  assert.equal(inferArchiveType('support-bundle.zip'), 'zip');
  assert.equal(inferArchiveType('support-bundle.tar'), 'tar');
  assert.equal(inferArchiveType('support-bundle.tar.gz'), 'tar');
  assert.equal(inferArchiveType('support-bundle.tgz'), 'tar');
  assert.equal(inferArchiveType('support-bundle.tar.zst'), 'tar');
});

test('does not infer unsupported single-file compression as an archive', () => {
  assert.equal(inferArchiveType('support-bundle.gz'), null);
  assert.equal(inferArchiveType('support-bundle.txt'), null);
});

test('accepts safe archive paths', () => {
  assert.doesNotThrow(() => validateArchiveEntryPath('longhorn-system/manager.log'));
  assert.doesNotThrow(() => validateArchiveEntries(['bundle/nodes/node-1/events.yaml']));
});

test('rejects unsafe archive paths', () => {
  assert.throws(() => validateArchiveEntryPath('/etc/passwd'), /absolute path/);
  assert.throws(() => validateArchiveEntryPath('../outside'), /unsafe path/);
  assert.throws(() => validateArchiveEntryPath('bundle/../../outside'), /unsafe path/);
  assert.throws(() => validateArchiveEntryPath('C:\\Windows\\system32'), /absolute path/);
});

test('previews extracted text files with line context', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-preview-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const reportPath = 'bundle/logs/longhorn-system/manager/manager.log';
  const filePath = path.join(workDir, 'job-1', 'extracted', reportPath);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      ['line 1', 'line 2', 'level=error failed to rebuild replica', 'line 4', 'line 5'].join('\n'),
      'utf8',
    );

    const preview = await analyzer.readExtractedFile({
      jobId: 'job-1',
      reportPath,
      lineStart: 1,
      lineEnd: 1,
      matchText: 'failed to rebuild replica',
    });

    assert.equal(preview.previewable, true);
    assert.equal(preview.path, reportPath);
    assert.equal(preview.requestedLineStart, 3);
    assert.equal(preview.matchedLine.lineNumber, 3);
    assert.match(preview.content, /failed to rebuild replica/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('searches extracted text files with short case-insensitive raw log keywords', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-search-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const reportPath = 'bundle/logs/harvester-system/controller.log';
  const filePath = path.join(workDir, 'job-1', 'extracted', reportPath);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      ['line 1', 'line 2', 'level=ERROR failed to sync virtual machine', 'line 4'].join('\n'),
      'utf8',
    );

    const preview = await analyzer.readExtractedFile({
      jobId: 'job-1',
      reportPath,
      searchText: 'error',
    });

    assert.equal(preview.previewable, true);
    assert.equal(preview.requestedLineStart, 3);
    assert.equal(preview.matchedLine.lineNumber, 3);
    assert.match(preview.content, /level=ERROR/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('searches extracted text files with raw log regular expressions', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-regex-search-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const reportPath = 'bundle/journald/rke2-server';
  const filePath = path.join(workDir, 'job-1', 'extracted', reportPath);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      ['line 1', 'level=info msg="ok"', 'level=warning msg="snapshot failed"', 'line 4'].join('\n'),
      'utf8',
    );

    const preview = await analyzer.readExtractedFile({
      jobId: 'job-1',
      reportPath,
      searchText: 'level=(warning|error)',
      searchRegex: true,
    });

    assert.equal(preview.previewable, true);
    assert.equal(preview.requestedLineStart, 3);
    assert.equal(preview.matchedLine.lineNumber, 3);
    assert.match(preview.content, /snapshot failed/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('rejects invalid raw log regular expressions', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-invalid-regex-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const reportPath = 'bundle/journald/rke2-agent';
  const filePath = path.join(workDir, 'job-1', 'extracted', reportPath);

  try {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, 'level=error msg="failed"\n', 'utf8');

    await assert.rejects(
      analyzer.readExtractedFile({
        jobId: 'job-1',
        reportPath,
        searchText: '[',
        searchRegex: true,
      }),
      (error) => error.statusCode === 400 && /Invalid regular expression/.test(error.message),
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('enriches existing Longhorn reports with detected version', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-report-enrich-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const settingsPath = path.join(
    workDir,
    'job-1',
    'extracted',
    'yamls/namespaced/longhorn-system/longhorn.io/v1beta2/settings.yaml',
  );

  try {
    await fs.mkdir(path.dirname(settingsPath), { recursive: true });
    await fs.writeFile(
      settingsPath,
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: longhorn.io/v1beta2',
        '  kind: Setting',
        '  metadata:',
        '    name: current-longhorn-version',
        '    namespace: longhorn-system',
        '  value: v1.8.2',
      ].join('\n'),
      'utf8',
    );

    const enriched = await analyzer.enrichExistingReport({
      jobId: 'job-1',
      productType: 'longhorn',
      inventory: {
        metadata: {},
        longhorn: {
          pods: { total: 1 },
        },
      },
    });

    assert.equal(enriched.inventory.longhorn.version.version, 'v1.8.2');
    assert.equal(enriched.inventory.longhorn.pods.total, 1);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('enriches existing Harvester reports with detected version', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-harvester-report-enrich-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const appsPath = path.join(
    workDir,
    'job-1',
    'extracted',
    'yamls/namespaced/harvester-system/catalog.cattle.io/v1/apps.yaml',
  );

  try {
    await fs.mkdir(path.dirname(appsPath), { recursive: true });
    await fs.writeFile(
      appsPath,
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: catalog.cattle.io/v1',
        '  kind: App',
        '  metadata:',
        '    name: harvester',
        '    namespace: harvester-system',
        '  status:',
        '    chart:',
        '      metadata:',
        '        version: 1.5.1',
        '    summary:',
        '      state: deployed',
      ].join('\n'),
      'utf8',
    );

    const enriched = await analyzer.enrichExistingReport({
      jobId: 'job-1',
      productType: 'harvester',
      inventory: {
        metadata: {},
        harvester: {
          pods: { total: 1 },
        },
      },
    });

    assert.equal(enriched.inventory.harvester.version.version, 'v1.5.1');
    assert.equal(enriched.inventory.harvester.pods.total, 1);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('rejects unsafe extracted file preview paths', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-preview-unsafe-'));
  const analyzer = new ArchiveAnalyzer({ workDir });

  try {
    await assert.rejects(
      analyzer.readExtractedFile({
        jobId: 'job-1',
        reportPath: '../outside.log',
      }),
      /unsafe path/,
    );
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('expands nested support bundle zip files for analysis and raw log preview', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-nested-work-'));
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-nested-fixture-'));
  const analyzer = new ArchiveAnalyzer({ workDir });

  try {
    const innerRoot = path.join(fixtureDir, 'inner');
    const innerLogPath = path.join(
      innerRoot,
      'logs',
      'harvester-system',
      'virt-controller',
      'virt-controller.log',
    );
    await fs.mkdir(path.dirname(innerLogPath), { recursive: true });
    await fs.writeFile(innerLogPath, 'level=error msg="failed to move vmi"\n', 'utf8');

    const innerZip = path.join(fixtureDir, 'harvester-node1.zip');
    await zipDirectory(innerRoot, innerZip);

    const outerRoot = path.join(fixtureDir, 'outer');
    await fs.mkdir(path.join(outerRoot, 'nodes'), { recursive: true });
    await fs.copyFile(innerZip, path.join(outerRoot, 'nodes', 'harvester-node1.zip'));
    await fs.writeFile(path.join(outerRoot, 'metadata.yaml'), 'issue: harvester v1.5.0\n', 'utf8');

    const outerZip = path.join(fixtureDir, 'supportbundle.zip');
    await zipDirectory(outerRoot, outerZip);
    const outerStats = await fs.stat(outerZip);

    const report = await analyzer.analyze({
      archivePath: outerZip,
      bundle: {
        id: 'bundle-1',
        productType: 'unknown',
        storedFilename: 'supportbundle.zip',
        originalFilename: 'supportbundle.zip',
        fileSize: outerStats.size,
        sha256: 'sha',
        storageBackend: 'local',
        storageRelativePath: 'supportbundle.zip',
      },
      jobId: 'job-1',
      updateStage: async () => {},
    });

    const nestedLogPath = 'nodes/harvester-node1/logs/harvester-system/virt-controller/virt-controller.log';
    assert.ok(report.fileIndex.some((entry) => entry.path === 'nodes/harvester-node1.zip'));
    assert.ok(report.fileIndex.some((entry) => entry.path === nestedLogPath));

    const preview = await analyzer.readExtractedFile({
      jobId: 'job-1',
      reportPath: nestedLogPath,
      searchText: 'failed to move',
    });

    assert.equal(preview.previewable, true);
    assert.match(preview.content, /failed to move vmi/);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
});

test('lists the complete extracted file index for raw log browsing', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-full-index-'));
  const analyzer = new ArchiveAnalyzer({ workDir });
  const extractDir = path.join(workDir, 'job-1', 'extracted');
  const fileCount = MAX_REPORT_FILE_ENTRIES + 2;

  try {
    await fs.mkdir(path.join(extractDir, 'logs'), { recursive: true });
    await fs.mkdir(path.join(extractDir, '.sba-analysis', 'nested-archives'), { recursive: true });
    await fs.writeFile(
      path.join(extractDir, '.sba-analysis', 'nested-archives', 'state.json'),
      '{}',
      'utf8',
    );

    for (let index = 0; index < fileCount; index += 1) {
      await fs.writeFile(
        path.join(extractDir, 'logs', `file-${String(index).padStart(5, '0')}.log`),
        'ok\n',
        'utf8',
      );
    }

    const result = await analyzer.listExtractedFiles({ jobId: 'job-1' });

    assert.equal(result.fileIndex.length, fileCount);
    assert.equal(result.summary.fileCount, fileCount);
    assert.equal(result.fileIndex.some((entry) => entry.path.includes('.sba-analysis')), false);
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
});

test('expands nested archives even when a same-name directory already exists', async () => {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-nested-existing-dir-work-'));
  const fixtureDir = await fs.mkdtemp(path.join(os.tmpdir(), 'archive-nested-existing-dir-fixture-'));
  const analyzer = new ArchiveAnalyzer({ workDir });

  try {
    const innerRoot = path.join(fixtureDir, 'inner');
    const innerLogPath = path.join(innerRoot, 'logs', 'node', 'node.log');
    await fs.mkdir(path.dirname(innerLogPath), { recursive: true });
    await fs.writeFile(innerLogPath, 'level=error msg="from nested zip"\n', 'utf8');

    const innerZip = path.join(fixtureDir, 'harvester-node1.zip');
    await zipDirectory(innerRoot, innerZip);

    const outerRoot = path.join(fixtureDir, 'outer');
    await fs.mkdir(path.join(outerRoot, 'nodes', 'harvester-node1'), { recursive: true });
    await fs.writeFile(path.join(outerRoot, 'nodes', 'harvester-node1', 'existing.log'), 'existing\n', 'utf8');
    await fs.copyFile(innerZip, path.join(outerRoot, 'nodes', 'harvester-node1.zip'));

    const outerZip = path.join(fixtureDir, 'supportbundle.zip');
    await zipDirectory(outerRoot, outerZip);
    const outerStats = await fs.stat(outerZip);

    const report = await analyzer.analyze({
      archivePath: outerZip,
      bundle: {
        id: 'bundle-1',
        productType: 'unknown',
        storedFilename: 'supportbundle.zip',
        originalFilename: 'supportbundle.zip',
        fileSize: outerStats.size,
        sha256: 'sha',
        storageBackend: 'local',
        storageRelativePath: 'supportbundle.zip',
      },
      jobId: 'job-1',
      updateStage: async () => {},
    });

    assert.ok(report.fileIndex.some((entry) => entry.path === 'nodes/harvester-node1/existing.log'));
    assert.ok(report.fileIndex.some((entry) => entry.path === 'nodes/harvester-node1.contents/logs/node/node.log'));
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
    await fs.rm(fixtureDir, { recursive: true, force: true });
  }
});

async function zipDirectory(sourceDir, zipPath) {
  await execFileAsync('zip', ['-qr', zipPath, '.'], {
    cwd: sourceDir,
  });
}
