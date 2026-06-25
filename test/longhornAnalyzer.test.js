import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeLonghornSupportBundle } from '../src/analysis/longhornAnalyzer.js';

test('builds Longhorn findings from support bundle files', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-analyzer-'));

  try {
    await writeFixtureFile(
      extractDir,
      'bundle/metadata.yaml',
      [
        'bundlename: support-bundle-test',
        'kubernetesversion: v1.32.11+rke2r1',
        'bundlecreatedat: "2026-05-07T06:58:47Z"',
        'issuedescription: test issue',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/bundleGenerationError.log',
      'Failed to get /api/v1/namespaces/default/bindings\nBUG: Support bundle: cannot get log for pod manager\n',
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/longhorn-system/v1/configmaps.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: v1',
        '  kind: ConfigMap',
        '  metadata:',
        '    labels:',
        '      app.kubernetes.io/name: longhorn',
        '      app.kubernetes.io/version: v1.8.1',
        '      helm.sh/chart: longhorn-1.8.1',
        '    name: longhorn-default-setting',
        '    namespace: longhorn-system',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/prometheus-alerts.json',
      JSON.stringify([
        {
          Labels: { alertname: 'LonghornVolumeActualSpaceUsedWarning', severity: 'warning' },
          Annotations: { summary: 'A Longhorn volume is using a lot of space.' },
          State: 'firing',
        },
      ]),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/longhorn-system/longhorn.io/v1beta2/volumes.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: longhorn.io/v1beta2',
        '  kind: Volume',
        '  metadata:',
        '    name: volume-a',
        '  status:',
        '    conditions:',
        '    - status: "True"',
        '      type: TooManySnapshots',
        '    currentNodeID: node-a',
        '    robustness: degraded',
        '    state: attached',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/longhorn-system/longhorn.io/v1beta2/nodes.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: longhorn.io/v1beta2',
        '  kind: Node',
        '  metadata:',
        '    name: node-a',
        '  status:',
        '    conditions:',
        '    - status: "False"',
        '      message: Kernel modules [dm_crypt] are not loaded',
        '      reason: KernelModulesNotLoaded',
        '      type: KernelModulesLoaded',
        '    diskStatus:',
        '      default-disk-a:',
        '        conditions:',
        '        - message: Disk default-disk-a(/var/lib/longhorn) on node node-a is not ready',
        '          reason: NoDiskInfo',
        '          status: "False"',
        '          type: Ready',
        '        - message: Disk default-disk-a(/var/lib/longhorn) on node node-a is not schedulable',
        '          reason: DiskNotReady',
        '          status: "False"',
        '          type: Schedulable',
        '        diskName: default-disk-a',
        '        diskPath: /var/lib/longhorn',
        '        storageAvailable: 0',
        '        storageMaximum: 0',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/longhorn-system/v1/pods.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: v1',
        '  kind: Pod',
        '  metadata:',
        '    name: longhorn-manager-a',
        '  status:',
        '    containerStatuses:',
        '    - name: manager',
        '      restartCount: 6',
        '    phase: Running',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/logs/longhorn-system/longhorn-manager-a/longhorn-manager.log',
      'time="2026-05-07T06:58:47Z" level=warning msg="Precheck failed for creating new replica: insufficient storage"\n',
    );

    const result = await analyzeLonghornSupportBundle({
      extractDir,
      index: await buildIndex(extractDir),
    });

    assert.equal(result.inventory.metadata.kubernetesversion, 'v1.32.11+rke2r1');
    assert.equal(result.inventory.longhorn.version.version, 'v1.8.1');
    assert.equal(result.inventory.longhorn.version.components[0].component, 'longhorn');
    assert.equal(result.inventory.longhorn.volumes.total, 1);
    assert.equal(result.inventory.longhorn.volumes.unhealthy, 1);
    assert.equal(result.inventory.longhorn.nodes.problematic, 1);
    assert.equal(result.inventory.longhorn.nodes.nodesWithDiskIssues, 1);
    assert.equal(result.inventory.longhorn.nodes.diskIssues, 2);
    assert.equal(result.inventory.longhorn.pods.withRestarts, 1);
    assert.equal(result.groupSummary.total, 6);
    assert.equal(result.groupSummary.critical, 1);
    assert.equal(result.groupSummary.warning, 5);
    assert.ok(result.findingSummary.warning >= 5);
    assert.ok(result.findingGroups.some((group) => group.id === 'longhorn-volume-replica-health'));
    assert.ok(result.findingGroups.some((group) => group.id === 'longhorn-replica-scheduling-capacity'));
    assert.ok(result.findingGroups.some((group) => group.id === 'longhorn-node-prerequisites'));
    assert.ok(result.findings.some((finding) => finding.id === 'longhorn-bundle-generation-errors'));
    assert.ok(result.findings.some((finding) => finding.title.includes('Volume volume-a is degraded')));
    assert.ok(result.findings.some((finding) => finding.title.includes('Node node-a')));
    assert.ok(result.findings.some((finding) => finding.title.includes('disk default-disk-a has Ready issue')));
    assert.ok(result.findings.some((finding) => finding.id === 'longhorn-log-replica-scheduling-storage'));
    const logFinding = result.findings.find((finding) => finding.id === 'longhorn-log-replica-scheduling-storage');
    assert.equal(logFinding.evidenceRefs[0].lineStart, 1);
    assert.equal(logFinding.evidenceRefs[0].path, 'bundle/logs/longhorn-system/longhorn-manager-a/longhorn-manager.log');
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
});

test('returns an empty finding set when Longhorn files are absent', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-analyzer-empty-'));

  try {
    const result = await analyzeLonghornSupportBundle({
      extractDir,
      index: [],
    });

    assert.deepEqual(result.findingSummary, {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    });
    assert.deepEqual(result.groupSummary, {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    });
    assert.deepEqual(result.findings, []);
    assert.deepEqual(result.findingGroups, []);
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
});

test('loads Longhorn log matching rules from YAML', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-analyzer-rules-'));
  const rulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-rules-'));

  try {
    await writeFixtureFile(
      rulesDir,
      'longhorn.yaml',
      [
        'logs:',
        '  rules:',
        '    - id: custom-longhorn-log-sentinel',
        '      severity: warning',
        '      category: Longhorn Logs',
        '      title: Custom Longhorn sentinel matched',
        '      description: Custom rule loaded from YAML matched a Longhorn log line.',
        '      regex: custom-longhorn-sentinel',
        '      flags: i',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/logs/longhorn-system/longhorn-manager-a/longhorn-manager.log',
      'time="2026-05-07T06:58:47Z" level=info msg="custom-longhorn-sentinel"',
    );

    const result = await analyzeLonghornSupportBundle({
      extractDir,
      index: await buildIndex(extractDir),
      rulesDir,
    });

    const finding = result.findings.find((item) => item.id === 'custom-longhorn-log-sentinel');
    assert.ok(finding);
    assert.equal(finding.evidenceRefs[0].lineStart, 1);
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.rm(rulesDir, { recursive: true, force: true });
  }
});

test('loads Longhorn condition matching rules from YAML', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-analyzer-condition-rules-'));
  const rulesDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-condition-rules-'));

  try {
    await writeFixtureFile(
      rulesDir,
      'longhorn.yaml',
      [
        'conditions:',
        '  rules:',
        '    - id: custom-longhorn-volume-{nameSlug}-{condition.typeSlug}',
        '      resource: longhornVolumeCondition',
        '      severity: critical',
        '      category: Longhorn Volume',
        '      title: Custom Longhorn condition for {name}',
        '      description: Custom condition rule loaded from YAML matched a Longhorn resource condition.',
        '      when: condition.status == True; condition.type == CustomBlocked',
        '      evidence: Type=condition.type,Status=condition.status,Reason=condition.reason,Message=condition.message',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/longhorn-system/longhorn.io/v1beta2/volumes.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: longhorn.io/v1beta2',
        '  kind: Volume',
        '  metadata:',
        '    name: volume-custom',
        '  status:',
        '    conditions:',
        '    - message: custom blocker is active',
        '      reason: CustomReason',
        '      status: "True"',
        '      type: CustomBlocked',
        '    robustness: healthy',
        '    state: attached',
      ].join('\n'),
    );

    const result = await analyzeLonghornSupportBundle({
      extractDir,
      index: await buildIndex(extractDir),
      rulesDir,
    });

    const finding = result.findings.find(
      (item) => item.id === 'custom-longhorn-volume-volume-custom-customblocked',
    );
    assert.ok(finding);
    assert.equal(finding.severity, 'critical');
    assert.equal(finding.title, 'Custom Longhorn condition for volume-custom');
    assert.ok(finding.evidence.includes('Reason: CustomReason'));
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
    await fs.rm(rulesDir, { recursive: true, force: true });
  }
});

test('keeps log evidence line references aligned for sampled large log files', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'longhorn-analyzer-large-log-'));
  const targetLine = 12050;
  const lines = Array.from({ length: 12500 }, (_, index) => {
    const lineNumber = index + 1;

    if (lineNumber === targetLine) {
      return '2026-01-01T00:00:00Z level=error msg="Precheck failed for creating new replica: insufficient storage"';
    }

    return `2026-01-01T00:00:00Z level=info msg="${String(lineNumber).padStart(5, '0')} ${'background log '.repeat(8)}"`;
  });

  try {
    await writeFixtureFile(
      extractDir,
      'bundle/logs/longhorn-system/longhorn-manager-a/longhorn-manager.log',
      lines.join('\n'),
    );

    const result = await analyzeLonghornSupportBundle({
      extractDir,
      index: await buildIndex(extractDir),
    });
    const logFinding = result.findings.find((finding) => finding.id === 'longhorn-log-replica-scheduling-storage');

    assert.equal(logFinding.evidenceRefs[0].lineStart, targetLine);
    assert.match(logFinding.evidence[0], new RegExp(`:${targetLine} `));
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
});

async function writeFixtureFile(rootDir, reportPath, content) {
  const filePath = path.join(rootDir, reportPath);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${content}\n`, 'utf8');
}

async function buildIndex(rootDir) {
  const entries = [];

  async function walk(currentDir, relativeDir = '') {
    const children = await fs.readdir(currentDir, { withFileTypes: true });

    for (const child of children) {
      const absolutePath = path.join(currentDir, child.name);
      const relativePath = path.posix.join(relativeDir, child.name);
      const stats = await fs.stat(absolutePath);

      if (child.isDirectory()) {
        entries.push({
          path: relativePath,
          type: 'directory',
          size: 0,
        });
        await walk(absolutePath, relativePath);
        continue;
      }

      entries.push({
        path: relativePath,
        type: 'file',
        size: stats.size,
      });
    }
  }

  await walk(rootDir);
  return entries;
}
