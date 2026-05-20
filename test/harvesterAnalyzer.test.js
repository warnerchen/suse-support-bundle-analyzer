import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { analyzeHarvesterSupportBundle } from '../src/analysis/harvesterAnalyzer.js';

test('builds Harvester findings from support bundle files', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harvester-analyzer-'));

  try {
    await writeFixtureFile(
      extractDir,
      'bundle/metadata.yaml',
      [
        'bundlename: support-bundle-test',
        'kubernetesversion: v1.32.4+rke2r1',
        'bundlecreatedat: "2026-05-20T15:35:29Z"',
        'issuedescription: harvester test',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/bundleGenerationError.log',
      'Failed to get /apis/upload.cdi.kubevirt.io/v1beta1/uploadtokenrequests\nBUG: Support bundle: cannot get log for pod virt-api\n',
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/harvester-system/catalog.cattle.io/v1/apps.yaml',
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
        '      state: failed',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/harvester-system/harvesterhci.io/v1beta1/versions.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: harvesterhci.io/v1beta1',
        '  kind: Version',
        '  metadata:',
        '    name: v1.6.1',
        '    namespace: harvester-system',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/cluster/v1/nodes.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: v1',
        '  kind: Node',
        '  metadata:',
        '    annotations:',
        '      node.harvesterhci.io/ntp-service: \'{"ntpSyncStatus":"unsynced"}\'',
        '    name: node-a',
        '  status:',
        '    conditions:',
        '    - message: kubelet is not ready',
        '      reason: KubeletNotReady',
        '      status: "False"',
        '      type: Ready',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/harvester-system/v1/pods.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: v1',
        '  kind: Pod',
        '  metadata:',
        '    labels:',
        '      app.kubernetes.io/name: harvester',
        '      app.kubernetes.io/version: v1.5.1',
        '    name: harvester-a',
        '  spec:',
        '    containers:',
        '    - image: rancher/harvester:v1.5.1',
        '      name: apiserver',
        '  status:',
        '    containerStatuses:',
        '    - name: apiserver',
        '      restartCount: 8',
        '    phase: Running',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/harvester-system/harvesterhci.io/v1beta1/addons.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: harvesterhci.io/v1beta1',
        '  kind: Addon',
        '  metadata:',
        '    name: vm-import-controller',
        '  spec:',
        '    enabled: true',
        '    version: 1.5.1',
        '  status:',
        '    conditions:',
        '    - status: "True"',
        '      type: OperationFailed',
        '    status: AddonDeployFailed',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/harvester-system/kubevirt.io/v1/kubevirts.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: kubevirt.io/v1',
        '  kind: KubeVirt',
        '  metadata:',
        '    name: kubevirt',
        '  status:',
        '    conditions:',
        '    - message: components degraded',
        '      reason: ComponentsDegraded',
        '      status: "True"',
        '      type: Degraded',
        '    observedKubeVirtVersion: 1.4.0-150600.5.15.1',
        '    phase: Deploying',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/cluster/cdi.kubevirt.io/v1beta1/cdis.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: cdi.kubevirt.io/v1beta1',
        '  kind: CDI',
        '  metadata:',
        '    name: cdi',
        '  status:',
        '    conditions:',
        '    - status: "True"',
        '      type: Available',
        '    operatorVersion: 1.61.0',
        '    phase: Deployed',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/namespaced/default/harvesterhci.io/v1beta1/virtualmachineimages.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: harvesterhci.io/v1beta1',
        '  kind: VirtualMachineImage',
        '  metadata:',
        '    name: image-a',
        '  spec:',
        '    displayName: ubuntu.qcow2',
        '    sourceType: download',
        '  status:',
        '    conditions:',
        '    - status: "False"',
        '      type: Imported',
        '    failed: 2',
        '    progress: 50',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/yamls/cluster/network.harvesterhci.io/v1beta1/vlanstatuses.yaml',
      [
        'apiVersion: v1',
        'items:',
        '- apiVersion: network.harvesterhci.io/v1beta1',
        '  kind: VlanStatus',
        '  metadata:',
        '    name: vlan-a',
        '  status:',
        '    clusterNetwork: vm-network',
        '    conditions:',
        '    - message: link down',
        '      status: "False"',
        '      type: ready',
        '    node: node-a',
        '    vlanConfig: ens3',
      ].join('\n'),
    );
    await writeFixtureFile(
      extractDir,
      'bundle/logs/harvester-system/virt-controller-a/virt-controller.log',
      '2026-05-20T14:28:38Z {"level":"error","msg":"Failed to mark node as unschedulable","reason":"failed calling webhook \\"validator.harvesterhci.io\\": 502 Bad Gateway"}\n',
    );

    const result = await analyzeHarvesterSupportBundle({
      extractDir,
      index: await buildIndex(extractDir),
    });

    assert.equal(result.inventory.metadata.kubernetesversion, 'v1.32.4+rke2r1');
    assert.equal(result.inventory.harvester.version.version, 'v1.5.1');
    assert.equal(result.inventory.harvester.version.components[0].component, 'harvester');
    assert.equal(result.inventory.harvester.nodes.withIssues, 1);
    assert.equal(result.inventory.harvester.pods.withRestarts, 1);
    assert.equal(result.inventory.harvester.apps.notDeployed, 1);
    assert.equal(result.inventory.harvester.addons.withIssues, 1);
    assert.equal(result.inventory.harvester.virtualization.unavailable, 1);
    assert.equal(result.inventory.harvester.vmImages.withIssues, 1);
    assert.equal(result.inventory.harvester.networks.withIssues, 1);
    assert.ok(result.findings.some((finding) => finding.id === 'harvester-bundle-generation-errors'));
    assert.ok(result.findings.some((finding) => finding.id === 'harvester-log-webhook-errors'));
    assert.ok(result.findings.some((finding) => finding.id === 'harvester-log-virtualization-scheduling'));
    assert.ok(result.findingGroups.some((group) => group.id === 'harvester-control-plane-health'));
    assert.ok(result.findingGroups.some((group) => group.id === 'harvester-virtualization-readiness'));
    assert.ok(result.findingGroups.some((group) => group.id === 'harvester-network-health'));
    const logFinding = result.findings.find((finding) => finding.id === 'harvester-log-webhook-errors');
    assert.equal(logFinding.evidenceRefs[0].lineStart, 1);
    assert.equal(logFinding.evidenceRefs[0].path, 'bundle/logs/harvester-system/virt-controller-a/virt-controller.log');
  } finally {
    await fs.rm(extractDir, { recursive: true, force: true });
  }
});

test('returns an empty finding set when Harvester files are absent', async () => {
  const extractDir = await fs.mkdtemp(path.join(os.tmpdir(), 'harvester-analyzer-empty-'));

  try {
    const result = await analyzeHarvesterSupportBundle({
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
