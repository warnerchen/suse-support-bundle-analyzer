import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  ArchiveAnalyzer,
  inferArchiveType,
  validateArchiveEntries,
  validateArchiveEntryPath,
} from '../src/analysis/archiveAnalyzer.js';

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
