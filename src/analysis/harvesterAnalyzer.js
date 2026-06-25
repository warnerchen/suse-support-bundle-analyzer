import fs from 'node:fs/promises';
import path from 'node:path';
import { analyzeLonghornSupportBundle } from './longhornAnalyzer.js';
import {
  buildConditionFinding,
  findConditionRule,
  isIncludedLogPath,
  loadProductConditionRules,
  loadProductLogConfig,
  priorityForLogPath,
} from './ruleLoader.js';

const HARVESTER_RESOURCE_ROOT = 'yamls/namespaced/harvester-system';
const MAX_FINDINGS_PER_RULE = 12;
const MAX_LOG_FILES = 80;
const LOG_SAMPLE_BYTES = 256 * 1024;
const MAX_CORRELATED_WORKLOADS = 12;
const WORKLOAD_LOG_FINDING_IDS = new Set([
  'harvester-log-virtualization-scheduling',
  'harvester-log-error-lines',
  'harvester-log-webhook-errors',
  'harvester-log-network-offload',
]);

const NODE_FALSE_CONDITIONS = new Set([
  'MemoryPressure',
  'DiskPressure',
  'PIDPressure',
  'NetworkUnavailable',
]);

const DEFAULT_LOG_CONFIG = {
  maxFiles: MAX_LOG_FILES,
  include: [
    '/logs/harvester-system/',
    '/logs/kube-system/kube-scheduler-',
    '/logs/kube-system/kube-proxy-',
    '/logs/kube-system/rke2-multus-',
    '/logs/kube-system/harvester-whereabouts-',
    '/logs/kube-system/rke2-canal-',
  ],
  priorities: [
    { pattern: '/harvester-b', priority: 1 },
    { pattern: '/harvester-webhook', priority: 2 },
    { pattern: '/virt-', priority: 2 },
    { pattern: '/cdi-', priority: 3 },
    { pattern: '/harvester-network', priority: 4 },
    { pattern: '/kube-vip', priority: 4 },
    { pattern: '/kube-scheduler', priority: 5 },
    { pattern: '/kube-proxy', priority: 5 },
  ],
  rules: [
    {
      id: 'harvester-log-webhook-errors',
      severity: 'warning',
      category: 'Harvester Logs',
      title: 'Harvester webhooks returned errors',
      description:
        'Harvester or KubeVirt logs contain webhook failures. These can block node updates, VM lifecycle operations, or API admission requests.',
      regex:
        'failed calling webhook|validator\\.harvesterhci\\.io|webhook.*(connection refused|bad gateway|no endpoints)|502 Bad Gateway',
      flags: 'i',
    },
    {
      id: 'harvester-log-virtualization-scheduling',
      severity: 'warning',
      category: 'Virtualization',
      title: 'Virtualization logs contain scheduling or migration errors',
      description:
        'KubeVirt or scheduler logs contain unschedulable, node selector, or migration-related messages that can explain VM placement failures.',
      regex:
        'failed to mark node as unschedulable|unschedulable|nodeSelector|node selector|didn.?t match|0/\\d+ nodes are available|live.?migration|migration.*failed',
      flags: 'i',
    },
    {
      id: 'harvester-log-network-offload',
      severity: 'warning',
      category: 'Harvester Network',
      title: 'Network logs mention offload settings',
      description:
        'Harvester network logs mention GRO, GSO, offload, or ethtool. These lines are worth reviewing when VM network throughput or packet handling is under investigation.',
      regex:
        '\\b(GRO|GSO)\\b|ethtool|ChecksumOffloadBroken:true|(?:disable|disabled|enable|enabled|rx|tx).*offload|offload.*(?:disable|disabled|enable|enabled|GRO|GSO|rx|tx)',
      flags: 'i',
    },
    {
      id: 'harvester-log-error-lines',
      severity: 'warning',
      category: 'Harvester Logs',
      title: 'Harvester platform logs contain error-level lines',
      description:
        'One or more Harvester platform log files contain error-level messages. Review the evidence lines for the first matching files.',
      regex: '\\blevel=error\\b|\\bE\\d{4}\\b|Unhandled Error',
      flags: 'i',
    },
  ],
};

const DEFAULT_CONDITION_RULES = [
  {
    id: 'harvester-node-{nameSlug}-{condition.typeSlug}',
    resource: 'harvesterNodeCondition',
    severity: 'warning',
    category: 'Harvester Node',
    title: 'Node {name} has {condition.type} issue',
    description:
      'A Harvester node readiness, pressure, or cluster membership condition is not in the expected state.',
    when: 'condition.status != True; condition.type in Ready|EtcdIsVoter',
    evidence: 'Type=condition.type,Status=condition.status,Reason=condition.reason,Message=condition.message',
    severityOverrides: 'condition.type=Ready:critical',
  },
  {
    id: 'harvester-node-{nameSlug}-{condition.typeSlug}',
    resource: 'harvesterNodeCondition',
    severity: 'warning',
    category: 'Harvester Node',
    title: 'Node {name} has {condition.type} issue',
    description:
      'A Harvester node readiness, pressure, or cluster membership condition is not in the expected state.',
    when: 'condition.status != False; condition.type in MemoryPressure|DiskPressure|PIDPressure|NetworkUnavailable',
    evidence: 'Type=condition.type,Status=condition.status,Reason=condition.reason,Message=condition.message',
  },
];

export const HARVESTER_RULE_DEFAULTS = {
  logs: DEFAULT_LOG_CONFIG,
  conditions: DEFAULT_CONDITION_RULES,
};

export async function analyzeHarvesterSupportBundle({ extractDir, index, rulesDir }) {
  const conditionRules = await loadProductConditionRules('harvester', DEFAULT_CONDITION_RULES, { rulesDir });
  const context = { extractDir, index, rulesDir, conditionRules };
  const findings = [];
  const inventory = {
    metadata: {},
    harvester: {},
  };

  inventory.metadata = await readSupportBundleMetadata(context);
  inventory.harvester.version = await detectHarvesterVersion(context);

  const collectionFinding = await analyzeBundleGenerationErrors(context);

  if (collectionFinding) {
    findings.push(collectionFinding);
  }

  const nodeAnalysis = await analyzeClusterNodes(context);
  inventory.harvester.nodes = nodeAnalysis.inventory;
  findings.push(...nodeAnalysis.findings);

  const podAnalysis = await analyzeHarvesterPods(context);
  inventory.harvester.pods = podAnalysis.inventory;
  findings.push(...podAnalysis.findings);

  const appAnalysis = await analyzeHarvesterApps(context);
  inventory.harvester.apps = appAnalysis.inventory;
  findings.push(...appAnalysis.findings);

  const addonAnalysis = await analyzeHarvesterAddons(context);
  inventory.harvester.addons = addonAnalysis.inventory;
  findings.push(...addonAnalysis.findings);

  const virtualizationAnalysis = await analyzeVirtualizationStack(context);
  inventory.harvester.virtualization = virtualizationAnalysis.inventory;
  findings.push(...virtualizationAnalysis.findings);

  const imageAnalysis = await analyzeVirtualMachineImages(context);
  inventory.harvester.vmImages = imageAnalysis.inventory;
  findings.push(...imageAnalysis.findings);

  const workloadAnalysis = await analyzeVirtualMachineWorkloads(context);
  inventory.harvester.workloads = workloadAnalysis.inventory;
  findings.push(...workloadAnalysis.findings);

  const networkAnalysis = await analyzeHarvesterNetwork(context);
  inventory.harvester.networks = networkAnalysis.inventory;
  findings.push(...networkAnalysis.findings);

  const storageAnalysis = await analyzeHarvesterStorage(context);
  inventory.harvester.storage = storageAnalysis.inventory;
  if (storageAnalysis.longhornInventory) {
    inventory.longhorn = storageAnalysis.longhornInventory;
  }
  findings.push(...storageAnalysis.findings);

  const eventAnalysis = await analyzeHarvesterEvents(context);
  inventory.harvester.events = eventAnalysis.inventory;
  findings.push(...eventAnalysis.findings);

  const logAnalysis = await analyzeHarvesterLogs(context);
  inventory.harvester.logs = logAnalysis.inventory;
  findings.push(...logAnalysis.findings);

  const sortedFindings = sortFindings(dedupeFindings(findings));
  const correlations = await buildHarvesterWorkloadCorrelations(context, {
    findings: sortedFindings,
  });
  const findingGroups = buildFindingGroups({
    findings: sortedFindings,
    inventory,
  });

  return {
    inventory,
    groupSummary: summarizeFindingGroups(findingGroups),
    findingGroups,
    findingSummary: summarizeFindings(sortedFindings),
    findings: sortedFindings,
    correlations,
  };
}

export async function buildHarvesterWorkloadCorrelations(context, { findings = [] } = {}) {
  const [virtualMachines, instances, migrations, images, networks, events] = await Promise.all([
    collectVirtualMachineRecords(context),
    collectVirtualMachineInstanceRecords(context),
    collectMigrationRecords(context),
    collectImageRecords(context),
    collectNetworkRecords(context),
    collectWarningEventRecords(context),
  ]);
  const logReferences = collectWorkloadLogReferences(findings);
  const findingById = new Map(findings.map((finding) => [finding.id, finding]));
  const workloads = new Map();

  for (const virtualMachine of virtualMachines) {
    workloads.set(virtualMachine.key, {
      namespace: virtualMachine.namespace,
      name: virtualMachine.name,
      vm: virtualMachine,
    });
  }

  for (const instance of instances) {
    const entry = workloads.get(instance.key) ?? {
      namespace: instance.namespace,
      name: instance.name,
    };

    entry.vmi = instance;
    workloads.set(instance.key, entry);
  }

  for (const migration of migrations) {
    const key = workloadKey(migration.namespace, migration.vmiName);
    const entry = workloads.get(key) ?? {
      namespace: migration.namespace,
      name: migration.vmiName,
    };

    entry.migrations = [...(entry.migrations ?? []), migration];
    workloads.set(key, entry);
  }

  const correlated = [...workloads.values()]
    .map((workload) =>
      buildWorkloadCorrelation({
        workload,
        images,
        networks,
        events,
        logReferences,
        findingById,
      }),
    )
    .filter(Boolean)
    .sort(
      (a, b) =>
        severityRank(a.severity) - severityRank(b.severity) ||
        b.signalCount - a.signalCount ||
        a.name.localeCompare(b.name),
    )
    .slice(0, MAX_CORRELATED_WORKLOADS);

  return {
    harvesterWorkloads: correlated,
  };
}

export async function detectHarvesterVersion(context) {
  const candidates = [];
  const sources = [
    {
      suffix: `${HARVESTER_RESOURCE_ROOT}/catalog.cattle.io/v1/apps.yaml`,
      collect: collectHarvesterAppVersions,
    },
    {
      suffix: `${HARVESTER_RESOURCE_ROOT}/v1/pods.yaml`,
      collect: collectHarvesterPodVersions,
    },
    {
      suffix: `${HARVESTER_RESOURCE_ROOT}/harvesterhci.io/v1beta1/addons.yaml`,
      collect: collectHarvesterAddonVersions,
    },
    {
      suffix: `${HARVESTER_RESOURCE_ROOT}/harvesterhci.io/v1beta1/versions.yaml`,
      collect: collectHarvesterAvailableVersions,
    },
  ];

  for (const source of sources) {
    const file = await readReportFile(context, source.suffix);

    if (!file) {
      continue;
    }

    candidates.push(
      ...source.collect(file.content).map((candidate) => ({
        ...candidate,
        path: file.reportPath,
      })),
    );
  }

  const selected = candidates.sort((a, b) => a.priority - b.priority)[0];

  if (!selected) {
    return null;
  }

  return {
    version: selected.version,
    source: selected.source,
    path: selected.path,
    components: uniqueVersionCandidates(candidates),
  };
}

export function summarizeFindings(findings) {
  const summary = {
    total: findings.length,
    critical: 0,
    warning: 0,
    info: 0,
  };

  for (const finding of findings) {
    if (Object.hasOwn(summary, finding.severity)) {
      summary[finding.severity] += 1;
    }
  }

  return summary;
}

export function summarizeFindingGroups(groups) {
  const summary = {
    total: groups.length,
    critical: 0,
    warning: 0,
    info: 0,
  };

  for (const group of groups) {
    if (Object.hasOwn(summary, group.severity)) {
      summary[group.severity] += 1;
    }
  }

  return summary;
}

function buildFindingGroups({ findings, inventory }) {
  const groups = [];
  const harvester = inventory.harvester ?? {};
  const collectionFinding = findFinding(findings, 'harvester-bundle-generation-errors');
  const podRestartFinding = findFinding(findings, 'harvester-pods-with-container-restarts');
  const errorLogFinding = findFinding(findings, 'harvester-log-error-lines');
  const webhookFinding = findFinding(findings, 'harvester-log-webhook-errors');
  const schedulingFinding = findFinding(findings, 'harvester-log-virtualization-scheduling');
  const networkLogFinding = findFinding(findings, 'harvester-log-network-offload');
  const nodeFindings = findings.filter((finding) => finding.category === 'Harvester Node');
  const podPhaseFindings = findings.filter(
    (finding) => finding.category === 'Harvester Pod' && finding.id !== 'harvester-pods-with-container-restarts',
  );
  const appFindings = findings.filter(
    (finding) => finding.category === 'Harvester App' || finding.category === 'Harvester Addon',
  );
  const virtualizationFindings = findings.filter((finding) => finding.category === 'Virtualization');
  const imageFindings = findings.filter((finding) => finding.category === 'Harvester Image');
  const workloadFindings = findings.filter((finding) => finding.category === 'Harvester VM');
  const networkFindings = findings.filter((finding) => finding.category === 'Harvester Network');
  const storageFindings = findings.filter((finding) => finding.category === 'Harvester Storage');
  const eventFindings = findings.filter((finding) => finding.category === 'Kubernetes Events');

  if (podRestartFinding || webhookFinding || appFindings.length || podPhaseFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'harvester-control-plane-health',
        severity: highestSeverity([podRestartFinding, webhookFinding, ...appFindings, ...podPhaseFindings]),
        title: 'Harvester control plane needs attention',
        description:
          'Harvester API, webhook, add-on, and controller pods form the control plane for VM and cluster management. Restarts or webhook errors can cause secondary failures.',
        impact:
          'VM operations, node updates, admission checks, and dashboard API requests can fail or become intermittent while these components recover.',
        affected: compactEvidence([
          affectedMetric('Harvester pods with restarts', harvester.pods?.withRestarts),
          affectedMetric('Apps not deployed', harvester.apps?.notDeployed),
          affectedMetric('Addons with issues', harvester.addons?.withIssues),
          webhookFinding ? affectedMetric('Webhook log matches', webhookFinding.count) : null,
        ]),
        recommendedChecks: [
          'Inspect the highest-restart Harvester pods first and compare restart timing with webhook errors.',
          'Open the related Harvester app or add-on YAML before assuming a dependent component is healthy.',
          'If webhook errors are clustered around startup, confirm whether they stopped after all pods became Ready.',
        ],
        evidence: mergeEvidence([podRestartFinding, webhookFinding, ...appFindings, ...podPhaseFindings]),
        relatedFindingIds: findingIds([podRestartFinding, webhookFinding, ...appFindings, ...podPhaseFindings]),
      }),
    );
  }

  if (virtualizationFindings.length || imageFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'harvester-virtualization-readiness',
        severity: highestSeverity([...virtualizationFindings, ...imageFindings]),
        title: 'Virtualization readiness should be checked',
        description:
          'KubeVirt, CDI, VM image import state, and scheduling logs together describe whether Harvester can place and start virtual machines reliably.',
        impact:
          'VM creation, image upload/import, node maintenance, or live migration may fail when this layer is degraded.',
        affected: compactEvidence([
          affectedMetric('Virtualization findings', virtualizationFindings.length),
          affectedMetric('VM images with issues', harvester.vmImages?.withIssues),
          schedulingFinding ? affectedMetric('Scheduling log matches', schedulingFinding.count) : null,
        ]),
        recommendedChecks: [
          'Confirm KubeVirt and CDI phases are Deployed with Available=True and Degraded=False.',
          'Open VM image YAML for images that are not Imported or have RetryLimitExceeded=True.',
          'For scheduling messages, compare node selectors, taints, labels, and maintenance or cordon state.',
        ],
        evidence: mergeEvidence([...virtualizationFindings, ...imageFindings]),
        relatedFindingIds: findingIds([...virtualizationFindings, ...imageFindings]),
      }),
    );
  }

  if (workloadFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'harvester-vm-workload-health',
        severity: highestSeverity([...workloadFindings, schedulingFinding]),
        title: 'Harvester VM workloads need attention',
        description:
          'VirtualMachine, VirtualMachineInstance, and migration resources show whether guest workloads are actually running, schedulable, and movable.',
        impact:
          'Affected VMs may stay stopped, pending, unschedulable, or fail live migration even if the Harvester control plane is available.',
        affected: compactEvidence([
          affectedMetric('VMs with issues', harvester.workloads?.vmIssues),
          affectedMetric('VMIs not running', harvester.workloads?.vmisNotRunning),
          affectedMetric('Failed migrations', harvester.workloads?.migrationsFailed),
          schedulingFinding ? affectedMetric('Scheduling log matches', schedulingFinding.count) : null,
        ]),
        recommendedChecks: [
          'Open the VM and VMI YAML together and compare desired run state, printableStatus, phase, nodeName, and Ready condition.',
          'For Pending or Unschedulable workloads, compare node selectors, taints, labels, maintenance mode, cordon state, and available resources.',
          'For failed migrations, inspect the VMIM resource plus virt-controller and virt-handler logs around the migration timestamp.',
        ],
        evidence: mergeEvidence([...workloadFindings, schedulingFinding]),
        relatedFindingIds: findingIds([...workloadFindings, schedulingFinding]),
      }),
    );
  }

  if (networkFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'harvester-network-health',
        severity: highestSeverity(networkFindings),
        title: 'Harvester network health needs review',
        description:
          'VLAN status and network-related logs can explain VM connectivity, bridge, multus, or offload-related symptoms.',
        impact:
          'Affected VMs may fail to attach to the expected network or experience degraded connectivity.',
        affected: compactEvidence([
          affectedMetric('Network issues', harvester.networks?.withIssues),
          networkLogFinding ? affectedMetric('Network log matches', networkLogFinding.count) : null,
        ]),
        recommendedChecks: [
          'Open VLANStatus resources and confirm ready=True for each node and VLAN config.',
          'Check link monitor and multus or whereabouts logs when VLANStatus is not ready.',
          'For offload findings, validate GRO/GSO settings on the involved NICs before changing VM networking.',
        ],
        evidence: mergeEvidence(networkFindings),
        relatedFindingIds: findingIds(networkFindings),
      }),
    );
  }

  if (storageFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'harvester-storage-health',
        severity: highestSeverity(storageFindings),
        title: 'Harvester storage health needs review',
        description:
          'Harvester VM disks are backed by Longhorn volumes and replicas. Longhorn disk, replica, or volume degradation can affect running VMs even when KubeVirt resources look healthy.',
        impact:
          'Affected VMs can lose storage redundancy, fail replica rebuilds, or become harder to recover after node or disk failures.',
        affected: compactEvidence([
          affectedMetric('Longhorn volumes', harvester.storage?.volumes),
          affectedMetric('Unhealthy volumes', harvester.storage?.unhealthyVolumes),
          affectedMetric('Replicas not running', harvester.storage?.replicasNotRunning),
          affectedMetric('Longhorn nodes with disk issues', harvester.storage?.nodesWithDiskIssues),
          affectedMetric('Replica scheduling log matches', harvester.storage?.replicaSchedulingLogMatches),
        ]),
        recommendedChecks: [
          'Open the Longhorn node YAML first when a disk is Ready=False or Schedulable=False.',
          'Compare degraded or unknown volumes with stopped replicas to find which node or disk is preventing rebuild.',
          'For repeated "no disks found" replica precheck messages, inspect Longhorn disk path, filesystem permissions, free space, and disk UUID on the named node.',
        ],
        evidence: mergeEvidence(storageFindings),
        relatedFindingIds: findingIds(storageFindings),
      }),
    );
  }

  if (nodeFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'harvester-node-health',
        severity: highestSeverity(nodeFindings),
        title: 'Harvester node health has signals',
        description:
          'Kubernetes node readiness, pressure conditions, etcd voter state, and Harvester NTP annotations are baseline signals for stable VM scheduling.',
        impact:
          'A problematic node can affect VM placement, migration, control-plane availability, or time-sensitive certificate and token flows.',
        affected: compactEvidence([
          affectedMetric('Nodes with issues', harvester.nodes?.withIssues),
          affectedMetric('Total Harvester nodes', harvester.nodes?.total),
        ]),
        recommendedChecks: [
          'Review node Ready, pressure, and EtcdIsVoter conditions together.',
          'Confirm NTP sync is healthy on all nodes before debugging timestamp-sensitive failures.',
        ],
        evidence: mergeEvidence(nodeFindings),
        relatedFindingIds: findingIds(nodeFindings),
      }),
    );
  }

  if (eventFindings.length || (errorLogFinding && !webhookFinding && !schedulingFinding)) {
    groups.push(
      createFindingGroup({
        id: 'harvester-platform-events-and-logs',
        severity: highestSeverity([errorLogFinding, ...eventFindings]),
        title: 'Platform events and logs contain warnings',
        description:
          'The bundle includes Kubernetes warning events or Harvester log errors that were not captured by a more specific rule.',
        impact:
          'These signals may point to transient startup issues or missing details that need manual review.',
        affected: compactEvidence([
          affectedMetric('Warning events', harvester.events?.warnings),
          errorLogFinding ? affectedMetric('Harvester log error lines', errorLogFinding.count) : null,
        ]),
        recommendedChecks: [
          'Open the first referenced log or event and decide whether it matches the customer symptom timeline.',
          'Treat repeated errors after startup as higher priority than one-time bootstrapping noise.',
        ],
        evidence: mergeEvidence([errorLogFinding, ...eventFindings]),
        relatedFindingIds: findingIds([errorLogFinding, ...eventFindings]),
      }),
    );
  }

  if (collectionFinding) {
    groups.push(
      createFindingGroup({
        id: 'harvester-collection-gaps',
        severity: collectionFinding.severity,
        title: 'Support bundle has collection gaps',
        description:
          'The support bundle generator could not collect every requested API resource or pod log.',
        impact:
          'The report can still be useful, but absence of a log or resource should not be treated as proof that it was healthy.',
        affected: [affectedMetric('Collection errors', collectionFinding.count)],
        recommendedChecks: [
          'Review bundleGenerationError.log before concluding a resource was unavailable.',
          'If a missing Harvester, KubeVirt, or CDI log is central to the case, collect a fresh bundle or query that pod directly.',
        ],
        evidence: mergeEvidence([collectionFinding]),
        relatedFindingIds: findingIds([collectionFinding]),
      }),
    );
  }

  return sortFindingGroups(groups);
}

async function readSupportBundleMetadata(context) {
  const file = await readReportFile(context, 'metadata.yaml');

  if (!file) {
    return {};
  }

  const metadata = {};

  for (const line of file.content.split(/\r?\n/)) {
    const match = line.match(/^([a-zA-Z0-9_-]+):\s*(.*)$/);

    if (match) {
      metadata[match[1]] = cleanScalar(match[2]);
    }
  }

  return metadata;
}

async function analyzeBundleGenerationErrors(context) {
  const file = await readReportFile(context, 'bundleGenerationError.log');

  if (!file) {
    return null;
  }

  const lines = file.content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (!lines.length) {
    return null;
  }

  return createFinding({
    id: 'harvester-bundle-generation-errors',
    severity: 'warning',
    category: 'Collection',
    title: 'Support bundle collection had errors',
    description:
      'The bundle generator reported resources or pod logs it could not collect. The analysis may be missing those details.',
    evidence: lines.slice(0, 6),
    count: lines.length,
    path: file.reportPath,
  });
}

async function analyzeClusterNodes(context) {
  const file = await readReportFile(context, 'yamls/cluster/v1/nodes.yaml');
  const inventory = {
    total: 0,
    notReady: 0,
    pressure: 0,
    ntpUnsynced: 0,
    withIssues: 0,
  };

  if (!file) {
    return { inventory, findings: [] };
  }

  const findings = [];
  const nodes = splitKubernetesItems(file.content);
  inventory.total = nodes.length;

  for (const node of nodes) {
    const name = readMetadataName(node) ?? 'unknown node';
    const metadata = topLevelSection(node, 'metadata');
    const status = topLevelSection(node, 'status');
    const conditions = extractConditions(status);
    let nodeHasIssue = false;

    for (const condition of conditions) {
      const finding = createConditionRuleFinding(
        context,
        'harvesterNodeCondition',
        conditionFacts({ name, condition }),
        file.reportPath,
      );

      if (!finding) {
        continue;
      }

      nodeHasIssue = true;

      if (condition.type === 'Ready') {
        inventory.notReady += 1;
      } else if (NODE_FALSE_CONDITIONS.has(condition.type)) {
        inventory.pressure += 1;
      }

      findings.push(finding);
    }

    const ntpStatus = extractNtpStatus(metadata);

    if (ntpStatus && ntpStatus !== 'synced') {
      nodeHasIssue = true;
      inventory.ntpUnsynced += 1;
      findings.push(
        createFinding({
          id: `harvester-node-${slugify(name)}-ntp-${slugify(ntpStatus)}`,
          severity: 'warning',
          category: 'Harvester Node',
          title: `Node ${name} NTP is ${ntpStatus}`,
          description: 'Harvester node annotation reports NTP is not synchronized.',
          evidence: [`NTP sync status: ${ntpStatus}`],
          path: file.reportPath,
        }),
      );
    }

    if (nodeHasIssue) {
      inventory.withIssues += 1;
    }
  }

  return { inventory, findings: findings.slice(0, MAX_FINDINGS_PER_RULE) };
}

async function analyzeHarvesterPods(context) {
  const file = await readReportFile(context, `${HARVESTER_RESOURCE_ROOT}/v1/pods.yaml`);
  const inventory = {
    total: 0,
    notRunning: 0,
    withRestarts: 0,
  };

  if (!file) {
    return { inventory, findings: [] };
  }

  const findings = [];
  const restartEvidence = [];
  const pods = splitKubernetesItems(file.content);
  inventory.total = pods.length;

  for (const pod of pods) {
    const name = readMetadataName(pod) ?? 'unknown pod';
    const status = topLevelSection(pod, 'status');
    const phase = readScalar(status, 'phase');

    if (phase && phase !== 'Running' && phase !== 'Succeeded') {
      inventory.notRunning += 1;
      findings.push(
        createFinding({
          id: `harvester-pod-${slugify(name)}-${slugify(phase)}`,
          severity: 'warning',
          category: 'Harvester Pod',
          title: `Pod ${name} is ${phase}`,
          description: 'A pod in harvester-system is not currently running.',
          evidence: [`Phase: ${phase}`],
          path: file.reportPath,
        }),
      );
    }

    const restarts = extractContainerRestarts(status).filter((container) => container.restartCount > 0);

    if (restarts.length) {
      inventory.withRestarts += 1;
      restartEvidence.push(
        `${name}: ${restarts
          .map((container) => `${container.name ?? 'container'}=${container.restartCount}`)
          .join(', ')}`,
      );
    }
  }

  if (restartEvidence.length) {
    findings.push(
      createFinding({
        id: 'harvester-pods-with-container-restarts',
        severity: restartEvidence.some((line) => /=[5-9]\d*|=\d{2,}/.test(line))
          ? 'warning'
          : 'info',
        category: 'Harvester Pod',
        title: 'Harvester pods have container restarts',
        description: 'One or more pods in harvester-system report non-zero container restart counts.',
        evidence: restartEvidence.slice(0, 8),
        count: restartEvidence.length,
        path: file.reportPath,
      }),
    );
  }

  return { inventory, findings: findings.slice(0, MAX_FINDINGS_PER_RULE) };
}

async function analyzeHarvesterApps(context) {
  const file = await readReportFile(context, `${HARVESTER_RESOURCE_ROOT}/catalog.cattle.io/v1/apps.yaml`);
  const inventory = {
    total: 0,
    notDeployed: 0,
  };

  if (!file) {
    return { inventory, findings: [] };
  }

  const apps = splitKubernetesItems(file.content);
  const problemApps = [];
  inventory.total = apps.length;

  for (const app of apps) {
    const name = readMetadataName(app) ?? 'unknown app';
    const status = topLevelSection(app, 'status');
    const state = extractYamlScalar(status, 'state');

    if (state && state !== 'deployed') {
      inventory.notDeployed += 1;
      problemApps.push(`${name}: ${state}`);
    }
  }

  if (!problemApps.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'harvester-apps-not-deployed',
        severity: 'warning',
        category: 'Harvester App',
        title: 'Harvester apps are not deployed',
        description: 'One or more catalog apps in harvester-system are not in deployed state.',
        evidence: problemApps.slice(0, 8),
        count: problemApps.length,
        path: file.reportPath,
      }),
    ],
  };
}

async function analyzeHarvesterAddons(context) {
  const file = await readReportFile(context, `${HARVESTER_RESOURCE_ROOT}/harvesterhci.io/v1beta1/addons.yaml`);
  const inventory = {
    total: 0,
    enabled: 0,
    withIssues: 0,
  };

  if (!file) {
    return { inventory, findings: [] };
  }

  const addons = splitKubernetesItems(file.content);
  const problemAddons = [];
  inventory.total = addons.length;

  for (const addon of addons) {
    const name = readMetadataName(addon) ?? 'unknown addon';
    const spec = topLevelSection(addon, 'spec');
    const status = topLevelSection(addon, 'status');
    const enabled = parseBoolean(readScalar(spec, 'enabled'));
    const addonStatus = readScalar(status, 'status');
    const conditions = extractConditions(status);
    const operationFailed = conditions.some(
      (condition) => condition.type === 'OperationFailed' && condition.status === 'True',
    );
    const inProgress = conditions.some(
      (condition) => condition.type === 'InProgress' && condition.status === 'True',
    );
    const isProblem = enabled && (operationFailed || inProgress || /failed/i.test(addonStatus ?? ''));

    if (enabled) {
      inventory.enabled += 1;
    }

    if (isProblem) {
      inventory.withIssues += 1;
      problemAddons.push(
        compactEvidence([
          `${name}: ${addonStatus ?? 'unknown status'}`,
          operationFailed ? 'OperationFailed=True' : null,
          inProgress ? 'InProgress=True' : null,
        ]).join(' · '),
      );
    }
  }

  if (!problemAddons.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'harvester-addons-not-ready',
        severity: 'warning',
        category: 'Harvester Addon',
        title: 'Enabled Harvester addons are not ready',
        description: 'One or more enabled Harvester addons are in a failed or in-progress state.',
        evidence: problemAddons.slice(0, 8),
        count: problemAddons.length,
        path: file.reportPath,
      }),
    ],
  };
}

async function analyzeVirtualizationStack(context) {
  const components = [
    {
      id: 'kubevirt',
      label: 'KubeVirt',
      suffix: `${HARVESTER_RESOURCE_ROOT}/kubevirt.io/v1/kubevirts.yaml`,
      versionKeys: ['observedKubeVirtVersion', 'operatorVersion'],
    },
    {
      id: 'cdi',
      label: 'CDI',
      suffix: 'yamls/cluster/cdi.kubevirt.io/v1beta1/cdis.yaml',
      versionKeys: ['operatorVersion'],
    },
  ];
  const inventory = {
    total: 0,
    unavailable: 0,
    components: [],
  };
  const findings = [];

  for (const component of components) {
    const file = await readReportFile(context, component.suffix);

    if (!file) {
      continue;
    }

    const resources = splitKubernetesItems(file.content);

    for (const resource of resources) {
      const status = topLevelSection(resource, 'status');
      const phase = readScalar(status, 'phase');
      const version = component.versionKeys
        .map((key) => readScalar(status, key))
        .find(Boolean);
      const conditions = extractConditions(status);
      const available = conditions.find((condition) => condition.type === 'Available');
      const degraded = conditions.find((condition) => condition.type === 'Degraded');
      const progressing = conditions.find((condition) => condition.type === 'Progressing');
      const hasIssue =
        (phase && phase !== 'Deployed') ||
        (available && available.status !== 'True') ||
        (degraded && degraded.status === 'True') ||
        (progressing && progressing.status === 'True');

      inventory.total += 1;
      inventory.components.push({
        name: component.label,
        phase,
        version,
        available: available?.status,
      });

      if (!hasIssue) {
        continue;
      }

      inventory.unavailable += 1;
      findings.push(
        createFinding({
          id: `harvester-${component.id}-not-ready`,
          severity: 'warning',
          category: 'Virtualization',
          title: `${component.label} is not fully ready`,
          description: `${component.label} status is not fully deployed and available.`,
          evidence: compactEvidence([
            phase ? `Phase: ${phase}` : null,
            available ? `Available: ${available.status}` : null,
            degraded ? `Degraded: ${degraded.status}` : null,
            progressing ? `Progressing: ${progressing.status}` : null,
            version ? `Version: ${version}` : null,
          ]),
          path: file.reportPath,
        }),
      );
    }
  }

  const kubevirt = inventory.components.find((component) => component.name === 'KubeVirt');
  const cdi = inventory.components.find((component) => component.name === 'CDI');

  if (kubevirt?.version) {
    inventory.kubevirtVersion = kubevirt.version;
  }

  if (cdi?.version) {
    inventory.cdiVersion = cdi.version;
  }

  return { inventory, findings };
}

async function analyzeVirtualMachineImages(context) {
  const files = await readReportFilesBySuffix(context, 'harvesterhci.io/v1beta1/virtualmachineimages.yaml');
  const inventory = {
    total: 0,
    withIssues: 0,
  };
  const findings = [];
  const problemImages = [];
  let firstPath = null;

  for (const file of files) {
    firstPath ??= file.reportPath;
    const images = splitKubernetesItems(file.content);
    inventory.total += images.length;

    for (const image of images) {
      const name = readMetadataName(image) ?? 'unknown image';
      const spec = topLevelSection(image, 'spec');
      const status = topLevelSection(image, 'status');
      const failed = Number.parseInt(readScalar(status, 'failed') ?? '0', 10) || 0;
      const progress = readScalar(status, 'progress');
      const sourceType = readScalar(spec, 'sourceType');
      const displayName = readScalar(spec, 'displayName') ?? name;
      const conditions = extractConditions(status);
      const imported = conditions.find((condition) => condition.type === 'Imported');
      const retryLimitExceeded = conditions.find((condition) => condition.type === 'RetryLimitExceeded');
      const hasIssue = failed > 0 || imported?.status !== 'True' || retryLimitExceeded?.status === 'True';

      if (!hasIssue) {
        continue;
      }

      inventory.withIssues += 1;
      problemImages.push(
        compactEvidence([
          `${displayName}: Imported=${imported?.status ?? 'unknown'}`,
          `failed=${failed}`,
          progress ? `progress=${progress}` : null,
          sourceType ? `sourceType=${sourceType}` : null,
          retryLimitExceeded?.status === 'True' ? 'RetryLimitExceeded=True' : null,
        ]).join(' · '),
      );
    }
  }

  if (problemImages.length) {
    findings.push(
      createFinding({
        id: 'harvester-vm-images-not-imported',
        severity: 'warning',
        category: 'Harvester Image',
        title: 'VM images are not fully imported',
        description: 'One or more Harvester VM images are not Imported=True or report failed import attempts.',
        evidence: problemImages.slice(0, 8),
        count: problemImages.length,
        path: firstPath,
      }),
    );
  }

  return { inventory, findings };
}

async function analyzeVirtualMachineWorkloads(context) {
  const [vmAnalysis, vmiAnalysis, migrationAnalysis] = await Promise.all([
    analyzeVirtualMachines(context),
    analyzeVirtualMachineInstances(context),
    analyzeVirtualMachineMigrations(context),
  ]);

  return {
    inventory: {
      vms: vmAnalysis.inventory.total,
      vmIssues: vmAnalysis.inventory.withIssues,
      desiredRunning: vmAnalysis.inventory.desiredRunning,
      running: vmAnalysis.inventory.running,
      stopped: vmAnalysis.inventory.stopped,
      vmis: vmiAnalysis.inventory.total,
      vmisNotRunning: vmiAnalysis.inventory.notRunning,
      migrations: migrationAnalysis.inventory.total,
      migrationsFailed: migrationAnalysis.inventory.failed,
      migrationsRunning: migrationAnalysis.inventory.running,
    },
    findings: [
      ...vmAnalysis.findings,
      ...vmiAnalysis.findings,
      ...migrationAnalysis.findings,
    ],
  };
}

async function analyzeVirtualMachines(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachines.yaml');
  const inventory = {
    total: 0,
    desiredRunning: 0,
    running: 0,
    stopped: 0,
    withIssues: 0,
  };
  const problemVMs = [];
  let firstPath = null;

  for (const file of files.filter((candidate) => candidate.reportPath.includes('/kubevirt.io/'))) {
    firstPath ??= file.reportPath;
    const virtualMachines = splitKubernetesItems(file.content);
    inventory.total += virtualMachines.length;

    for (const virtualMachine of virtualMachines) {
      const name = readResourceDisplayName(virtualMachine) ?? 'unknown vm';
      const spec = topLevelSection(virtualMachine, 'spec');
      const status = topLevelSection(virtualMachine, 'status');
      const running = parseBoolean(readScalar(spec, 'running'));
      const runStrategy = readScalar(spec, 'runStrategy');
      const desiredRunning = isVmDesiredRunning({ running, runStrategy });
      const printableStatus = readScalar(status, 'printableStatus') ?? readScalar(status, 'phase');
      const ready = extractConditions(status).find((condition) => condition.type === 'Ready');
      const created = parseBoolean(readScalar(status, 'created'));
      const nodeName = readScalar(status, 'nodeName');
      const issueReason = vmIssueReason({
        printableStatus,
        desiredRunning,
        ready,
        created,
      });

      if (desiredRunning) {
        inventory.desiredRunning += 1;
      }

      if (isRunningStatus(printableStatus)) {
        inventory.running += 1;
      } else if (isStoppedStatus(printableStatus)) {
        inventory.stopped += 1;
      }

      if (!issueReason) {
        continue;
      }

      inventory.withIssues += 1;
      problemVMs.push(
        compactEvidence([
          `${name}: ${issueReason}`,
          printableStatus ? `printableStatus=${printableStatus}` : null,
          runStrategy ? `runStrategy=${runStrategy}` : null,
          running !== null ? `running=${running}` : null,
          ready ? `Ready=${ready.status}` : null,
          nodeName ? `node=${nodeName}` : null,
        ]).join(' · '),
      );
    }
  }

  if (!problemVMs.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'harvester-vms-not-ready',
        severity: problemVMs.some((line) => /Unschedulable|Error|Failed|CrashLoop|PvcNotFound|DataVolume/i.test(line))
          ? 'critical'
          : 'warning',
        category: 'Harvester VM',
        title: 'Virtual machines are not ready',
        description:
          'One or more KubeVirt VirtualMachine resources are not in the expected running or ready state.',
        evidence: problemVMs.slice(0, 8),
        count: problemVMs.length,
        path: firstPath,
      }),
    ],
  };
}

async function analyzeVirtualMachineInstances(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachineinstances.yaml');
  const inventory = {
    total: 0,
    running: 0,
    notRunning: 0,
  };
  const problemVMIs = [];
  let firstPath = null;

  for (const file of files.filter((candidate) => candidate.reportPath.includes('/kubevirt.io/'))) {
    firstPath ??= file.reportPath;
    const instances = splitKubernetesItems(file.content);
    inventory.total += instances.length;

    for (const instance of instances) {
      const name = readResourceDisplayName(instance) ?? 'unknown vmi';
      const status = topLevelSection(instance, 'status');
      const phase = readScalar(status, 'phase');
      const nodeName = readScalar(status, 'nodeName');
      const reason = readScalar(status, 'reason');
      const ready = extractConditions(status).find((condition) => condition.type === 'Ready');
      const synchronized = extractConditions(status).find((condition) => condition.type === 'Synchronized');
      const isRunning = phase === 'Running' && (!ready || ready.status === 'True');

      if (isRunning) {
        inventory.running += 1;
        continue;
      }

      inventory.notRunning += 1;
      problemVMIs.push(
        compactEvidence([
          `${name}: phase=${phase ?? 'unknown'}`,
          nodeName ? `node=${nodeName}` : null,
          reason ? `reason=${reason}` : null,
          ready ? `Ready=${ready.status}` : null,
          synchronized ? `Synchronized=${synchronized.status}` : null,
          ready?.message ? `message=${ready.message}` : null,
        ]).join(' · '),
      );
    }
  }

  if (!problemVMIs.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'harvester-vmis-not-running',
        severity: problemVMIs.some((line) => /Failed|CrashLoop|Unschedulable|Error/i.test(line))
          ? 'critical'
          : 'warning',
        category: 'Harvester VM',
        title: 'VirtualMachineInstances are not running',
        description:
          'One or more KubeVirt VirtualMachineInstance resources are not Running with Ready=True.',
        evidence: problemVMIs.slice(0, 8),
        count: problemVMIs.length,
        path: firstPath,
      }),
    ],
  };
}

async function analyzeVirtualMachineMigrations(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachineinstancemigrations.yaml');
  const inventory = {
    total: 0,
    running: 0,
    failed: 0,
  };
  const failedMigrations = [];
  let firstPath = null;

  for (const file of files.filter((candidate) => candidate.reportPath.includes('/kubevirt.io/'))) {
    firstPath ??= file.reportPath;
    const migrations = splitKubernetesItems(file.content);
    inventory.total += migrations.length;

    for (const migration of migrations) {
      const name = readResourceDisplayName(migration) ?? 'unknown migration';
      const spec = topLevelSection(migration, 'spec');
      const status = topLevelSection(migration, 'status');
      const phase = readScalar(status, 'phase');
      const vmiName = readScalar(spec, 'vmiName') ?? extractYamlScalar(status, 'vmiName');
      const sourceNode = extractYamlScalar(status, 'sourceNode');
      const targetNode = extractYamlScalar(status, 'targetNode');
      const conditions = extractConditions(status);
      const failedCondition = conditions.find(
        (condition) => condition.type === 'Failed' && condition.status === 'True',
      );
      const failed = phase === 'Failed' || phase === 'Scheduling' || failedCondition;

      if (phase === 'Running') {
        inventory.running += 1;
      }

      if (!failed) {
        continue;
      }

      inventory.failed += 1;
      failedMigrations.push(
        compactEvidence([
          `${name}: phase=${phase ?? 'unknown'}`,
          vmiName ? `vmi=${vmiName}` : null,
          sourceNode ? `source=${sourceNode}` : null,
          targetNode ? `target=${targetNode}` : null,
          failedCondition?.reason ? `reason=${failedCondition.reason}` : null,
          failedCondition?.message ? `message=${failedCondition.message}` : null,
        ]).join(' · '),
      );
    }
  }

  if (!failedMigrations.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'harvester-vm-migrations-failed',
        severity: 'warning',
        category: 'Harvester VM',
        title: 'Virtual machine migrations failed',
        description:
          'One or more KubeVirt VirtualMachineInstanceMigration resources are failed or stuck in scheduling.',
        evidence: failedMigrations.slice(0, 8),
        count: failedMigrations.length,
        path: firstPath,
      }),
    ],
  };
}

async function collectVirtualMachineRecords(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachines.yaml');
  const records = [];

  for (const file of files.filter((candidate) => candidate.reportPath.includes('/kubevirt.io/'))) {
    for (const virtualMachine of splitKubernetesItems(file.content)) {
      const name = readMetadataName(virtualMachine);
      const namespace = readMetadataNamespace(virtualMachine) ?? namespaceFromReportPath(file.reportPath);

      if (!name) {
        continue;
      }

      const spec = topLevelSection(virtualMachine, 'spec');
      const status = topLevelSection(virtualMachine, 'status');
      const running = parseBoolean(readScalar(spec, 'running'));
      const runStrategy = readScalar(spec, 'runStrategy');
      const desiredRunning = isVmDesiredRunning({ running, runStrategy });
      const printableStatus = readScalar(status, 'printableStatus') ?? readScalar(status, 'phase');
      const ready = extractConditions(status).find((condition) => condition.type === 'Ready');
      const created = parseBoolean(readScalar(status, 'created'));
      const nodeName = readScalar(status, 'nodeName') ?? extractYamlScalar(status, 'nodeName');

      records.push({
        kind: 'VirtualMachine',
        key: workloadKey(namespace, name),
        namespace,
        name,
        path: file.reportPath,
        printableStatus,
        desiredRunning,
        runStrategy,
        running,
        readyStatus: ready?.status ?? null,
        readyMessage: ready?.message ?? null,
        nodeName,
        desiredNodeNames: extractNodeSelectorValues(spec),
        imageNames: extractReferencedImageNames(virtualMachine),
        networkNames: extractVmNetworkNames(virtualMachine),
        sourceText: virtualMachine,
        issueReason: vmIssueReason({
          printableStatus,
          desiredRunning,
          ready,
          created,
        }),
      });
    }
  }

  return records;
}

async function collectVirtualMachineInstanceRecords(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachineinstances.yaml');
  const records = [];

  for (const file of files.filter((candidate) => candidate.reportPath.includes('/kubevirt.io/'))) {
    for (const instance of splitKubernetesItems(file.content)) {
      const name = readMetadataName(instance);
      const namespace = readMetadataNamespace(instance) ?? namespaceFromReportPath(file.reportPath);

      if (!name) {
        continue;
      }

      const status = topLevelSection(instance, 'status');
      const phase = readScalar(status, 'phase');
      const nodeName = readScalar(status, 'nodeName');
      const reason = readScalar(status, 'reason');
      const ready = extractConditions(status).find((condition) => condition.type === 'Ready');
      const synchronized = extractConditions(status).find((condition) => condition.type === 'Synchronized');
      const isRunning = phase === 'Running' && (!ready || ready.status === 'True');

      records.push({
        kind: 'VirtualMachineInstance',
        key: workloadKey(namespace, name),
        namespace,
        name,
        path: file.reportPath,
        phase,
        nodeName,
        reason,
        readyStatus: ready?.status ?? null,
        readyMessage: ready?.message ?? null,
        synchronizedStatus: synchronized?.status ?? null,
        issueReason: isRunning
          ? null
          : compactEvidence([
              `phase=${phase ?? 'unknown'}`,
              reason ? `reason=${reason}` : null,
              ready ? `Ready=${ready.status}` : null,
              ready?.message ? ready.message : null,
            ]).join(' · '),
      });
    }
  }

  return records;
}

async function collectMigrationRecords(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachineinstancemigrations.yaml');
  const records = [];

  for (const file of files.filter((candidate) => candidate.reportPath.includes('/kubevirt.io/'))) {
    for (const migration of splitKubernetesItems(file.content)) {
      const name = readMetadataName(migration);
      const namespace = readMetadataNamespace(migration) ?? namespaceFromReportPath(file.reportPath);
      const spec = topLevelSection(migration, 'spec');
      const status = topLevelSection(migration, 'status');
      const vmiName = readScalar(spec, 'vmiName') ?? extractYamlScalar(status, 'vmiName');

      if (!name || !vmiName) {
        continue;
      }

      const phase = readScalar(status, 'phase');
      const sourceNode = extractYamlScalar(status, 'sourceNode');
      const targetNode = extractYamlScalar(status, 'targetNode');
      const failedCondition = extractConditions(status).find(
        (condition) => condition.type === 'Failed' && condition.status === 'True',
      );
      const failed = phase === 'Failed' || phase === 'Scheduling' || Boolean(failedCondition);

      records.push({
        kind: 'VirtualMachineInstanceMigration',
        namespace,
        name,
        path: file.reportPath,
        vmiName,
        phase,
        sourceNode,
        targetNode,
        failed,
        reason: failedCondition?.reason ?? null,
        message: failedCondition?.message ?? null,
      });
    }
  }

  return records;
}

async function collectImageRecords(context) {
  const files = await readReportFilesBySuffix(context, '/virtualmachineimages.yaml');
  const records = [];

  for (const file of files) {
    for (const image of splitKubernetesItems(file.content)) {
      const name = readMetadataName(image);
      const namespace = readMetadataNamespace(image) ?? namespaceFromReportPath(file.reportPath);

      if (!name) {
        continue;
      }

      const spec = topLevelSection(image, 'spec');
      const status = topLevelSection(image, 'status');
      const failed = Number.parseInt(readScalar(status, 'failed') ?? '0', 10) || 0;
      const progress = readScalar(status, 'progress');
      const sourceType = readScalar(spec, 'sourceType');
      const displayName = readScalar(spec, 'displayName') ?? name;
      const imported = extractConditions(status).find((condition) => condition.type === 'Imported');
      const retryLimitExceeded = extractConditions(status).find((condition) => condition.type === 'RetryLimitExceeded');

      records.push({
        kind: 'VirtualMachineImage',
        namespace,
        name,
        displayName,
        path: file.reportPath,
        failed,
        progress,
        sourceType,
        importedStatus: imported?.status ?? null,
        hasIssue: failed > 0 || imported?.status !== 'True' || retryLimitExceeded?.status === 'True',
      });
    }
  }

  return records;
}

async function collectNetworkRecords(context) {
  const files = await readReportFilesBySuffix(context, 'network.harvesterhci.io/v1beta1/vlanstatuses.yaml');
  const records = [];

  for (const file of files) {
    for (const resource of splitKubernetesItems(file.content)) {
      const name = readMetadataName(resource);

      if (!name) {
        continue;
      }

      const status = topLevelSection(resource, 'status');
      const ready = extractConditions(status).find((condition) => condition.type?.toLowerCase() === 'ready');

      records.push({
        kind: 'VlanStatus',
        name,
        path: file.reportPath,
        node: readScalar(status, 'node'),
        clusterNetwork: readScalar(status, 'clusterNetwork'),
        vlanConfig: readScalar(status, 'vlanConfig'),
        readyStatus: ready?.status ?? null,
        message: ready?.message ?? null,
        hasIssue: ready?.status !== 'True',
      });
    }
  }

  return records;
}

async function collectWarningEventRecords(context) {
  const files = await readReportFilesBySuffix(context, '/events.yaml');
  const records = [];

  for (const file of files) {
    for (const event of splitKubernetesItems(file.content)) {
      const type = readTopLevelScalar(event, 'type');

      if (type !== 'Warning') {
        continue;
      }

      const ref = readEventObjectRef(event);
      const reason = readTopLevelScalar(event, 'reason') ?? 'Warning';
      const message = readTopLevelScalar(event, 'message') ?? readTopLevelScalar(event, 'note') ?? 'Warning event';

      records.push({
        namespace: ref.namespace ?? readMetadataNamespace(event) ?? namespaceFromReportPath(file.reportPath),
        involvedKind: ref.kind,
        involvedName: ref.name,
        reason,
        message,
        path: file.reportPath,
      });
    }
  }

  return records;
}

function collectWorkloadLogReferences(findings) {
  return findings
    .filter((finding) => WORKLOAD_LOG_FINDING_IDS.has(finding.id))
    .flatMap((finding) =>
      (finding.evidenceRefs ?? []).map((ref, index) => ({
        ...ref,
        findingId: finding.id,
        evidence: finding.evidence?.[index] ?? ref.excerpt ?? '',
      })),
    );
}

function buildWorkloadCorrelation({ workload, images, networks, events, logReferences, findingById }) {
  const vm = workload.vm ?? null;
  const vmi = workload.vmi ?? null;
  const migrations = workload.migrations ?? [];
  const nodeName =
    vmi?.nodeName ??
    vm?.nodeName ??
    migrations.find((migration) => migration.sourceNode)?.sourceNode ??
    null;
  const desiredNodeNames = vm?.desiredNodeNames ?? [];
  const matchedImages = matchImagesToWorkload(vm, images);
  const matchedNetworks = matchNetworksToWorkload({ vm, vmi, migrations, networks });
  const matchedEvents = events.filter((event) => eventMatchesWorkload(event, workload)).slice(0, 3);
  const matchedLogs = logReferences.filter((ref) => logReferenceMatchesWorkload(ref, workload)).slice(0, 3);
  const failedMigration = migrations.find((migration) => migration.failed);
  const imageWithIssue = matchedImages.find((image) => image.hasIssue);
  const networkWithIssue = matchedNetworks.find((network) => network.hasIssue);
  const relatedFindingIds = new Set();

  if (vm?.issueReason) {
    relatedFindingIds.add('harvester-vms-not-ready');
  }

  if (vmi?.issueReason) {
    relatedFindingIds.add('harvester-vmis-not-running');
  }

  if (failedMigration) {
    relatedFindingIds.add('harvester-vm-migrations-failed');
  }

  if (imageWithIssue) {
    relatedFindingIds.add('harvester-vm-images-not-imported');
  }

  if (networkWithIssue) {
    relatedFindingIds.add('harvester-vlan-status-not-ready');
  }

  if (matchedEvents.length) {
    relatedFindingIds.add('harvester-warning-events');
  }

  for (const ref of matchedLogs) {
    relatedFindingIds.add(ref.findingId);
  }

  const relatedFindings = [...relatedFindingIds]
    .map((id) => findingById.get(id))
    .filter(Boolean);

  if (!relatedFindings.length) {
    return null;
  }

  const imageNames = uniqueValues(matchedImages.map((image) => image.displayName ?? image.name));
  const networkNames = uniqueValues([
    ...(vm?.networkNames ?? []),
    ...matchedNetworks.map((network) => network.clusterNetwork ?? network.name),
  ]);
  const status = vm?.printableStatus ?? (vmi?.phase ? `VMI ${vmi.phase}` : null);
  const signalCount =
    Number(Boolean(vm?.issueReason)) +
    Number(Boolean(vmi?.issueReason)) +
    migrations.filter((migration) => migration.failed).length +
    matchedImages.filter((image) => image.hasIssue).length +
    matchedNetworks.filter((network) => network.hasIssue).length +
    matchedEvents.length +
    matchedLogs.length;

  return {
    kind: 'VirtualMachine',
    namespace: workload.namespace,
    name: workload.name,
    severity: highestSeverity(relatedFindings),
    status,
    vmiPhase: vmi?.phase ?? null,
    nodeName,
    desiredNodeNames,
    imageNames,
    networkNames,
    migrations: migrations
      .filter((migration) => migration.failed || migration.phase)
      .map((migration) => ({
        name: migration.name,
        phase: migration.phase,
        sourceNode: migration.sourceNode,
        targetNode: migration.targetNode,
      }))
      .slice(0, 3),
    eventCount: matchedEvents.length,
    logCount: matchedLogs.length,
    signalCount,
    relatedFindingIds: [...relatedFindingIds],
    paths: compactObject({
      vm: vm?.path,
      vmi: vmi?.path,
      migration: failedMigration?.path ?? migrations[0]?.path,
      image: imageWithIssue?.path ?? matchedImages[0]?.path,
      network: networkWithIssue?.path ?? matchedNetworks[0]?.path,
    }),
    evidence: compactEvidence([
      vm?.issueReason ? `VM: ${vm.issueReason}` : null,
      vmi?.issueReason ? `VMI: ${vmi.issueReason}` : null,
      failedMigration ? `Migration: ${failedMigration.phase ?? 'failed'}` : null,
      imageWithIssue ? `Image: ${imageWithIssue.displayName ?? imageWithIssue.name}` : null,
      networkWithIssue ? `Network: ${networkWithIssue.clusterNetwork ?? networkWithIssue.name}` : null,
      matchedEvents[0] ? `Event: ${matchedEvents[0].reason} ${truncate(matchedEvents[0].message, 120)}` : null,
      matchedLogs[0] ? `Log: ${truncate(matchedLogs[0].excerpt ?? matchedLogs[0].evidence, 120)}` : null,
    ]),
  };
}

async function analyzeHarvesterNetwork(context) {
  const files = await readReportFilesBySuffix(context, 'network.harvesterhci.io/v1beta1/vlanstatuses.yaml');
  const inventory = {
    total: 0,
    withIssues: 0,
  };
  const findings = [];
  const problemNetworks = [];
  let firstPath = null;

  for (const file of files) {
    firstPath ??= file.reportPath;
    const statuses = splitKubernetesItems(file.content);
    inventory.total += statuses.length;

    for (const resource of statuses) {
      const name = readMetadataName(resource) ?? 'unknown vlan status';
      const status = topLevelSection(resource, 'status');
      const node = readScalar(status, 'node');
      const clusterNetwork = readScalar(status, 'clusterNetwork');
      const vlanConfig = readScalar(status, 'vlanConfig');
      const ready = extractConditions(status).find((condition) => condition.type?.toLowerCase() === 'ready');

      if (ready?.status === 'True') {
        continue;
      }

      inventory.withIssues += 1;
      problemNetworks.push(
        compactEvidence([
          `${name}: ready=${ready?.status ?? 'unknown'}`,
          node ? `node=${node}` : null,
          clusterNetwork ? `clusterNetwork=${clusterNetwork}` : null,
          vlanConfig ? `vlanConfig=${vlanConfig}` : null,
          ready?.message ? `message=${ready.message}` : null,
        ]).join(' · '),
      );
    }
  }

  if (problemNetworks.length) {
    findings.push(
      createFinding({
        id: 'harvester-vlan-status-not-ready',
        severity: 'warning',
        category: 'Harvester Network',
        title: 'VLAN statuses are not ready',
        description: 'One or more Harvester VLANStatus resources are not ready.',
        evidence: problemNetworks.slice(0, 8),
        count: problemNetworks.length,
        path: firstPath,
      }),
    );
  }

  return { inventory, findings };
}

async function analyzeHarvesterStorage(context) {
  const longhornAnalysis = await analyzeLonghornSupportBundle(context);
  const longhorn = longhornAnalysis.inventory?.longhorn ?? {};
  const findings = [];
  const longhornFindings = longhornAnalysis.findings ?? [];
  const volumeFindings = longhornFindings.filter((finding) => finding.category === 'Longhorn Volume');
  const replicaFindings = longhornFindings.filter((finding) => finding.category === 'Longhorn Replica');
  const nodeFindings = longhornFindings.filter((finding) => finding.category === 'Longhorn Node');
  const schedulingFinding = longhornFindings.find(
    (finding) => finding.id === 'longhorn-log-replica-scheduling-storage',
  );
  const inventory = {
    longhornVersion: longhorn.version?.version ?? null,
    volumes: longhorn.volumes?.total ?? 0,
    unhealthyVolumes: longhorn.volumes?.unhealthy ?? 0,
    replicas: longhorn.replicas?.total ?? 0,
    replicasNotRunning: longhorn.replicas?.notRunning ?? 0,
    nodes: longhorn.nodes?.total ?? 0,
    nodesWithDiskIssues: longhorn.nodes?.nodesWithDiskIssues ?? longhorn.nodes?.problematic ?? 0,
    diskIssues: longhorn.nodes?.diskIssues ?? 0,
    replicaSchedulingLogMatches: schedulingFinding?.count ?? 0,
  };

  if (!hasLonghornStorageInventory(inventory)) {
    return { inventory, findings: [], longhornInventory: null };
  }

  if (inventory.unhealthyVolumes > 0) {
    findings.push(
      createFinding({
        id: 'harvester-longhorn-volumes-unhealthy',
        severity: volumeFindings.some((finding) => finding.severity === 'critical') ? 'critical' : 'warning',
        category: 'Harvester Storage',
        title: 'Longhorn volumes backing Harvester workloads are unhealthy',
        description:
          'Longhorn reports degraded, faulted, or unknown volume robustness for volumes present in this Harvester bundle.',
        evidence: summarizeRelatedFindings(volumeFindings, 'Longhorn volume').slice(0, 8),
        count: inventory.unhealthyVolumes,
        path: volumeFindings[0]?.path ?? null,
      }),
    );
  }

  if (inventory.replicasNotRunning > 0) {
    findings.push(
      createFinding({
        id: 'harvester-longhorn-replicas-not-running',
        severity: 'warning',
        category: 'Harvester Storage',
        title: 'Longhorn replicas are not running',
        description:
          'Longhorn replicas backing Harvester storage are stopped or otherwise not running. This often explains degraded volume redundancy.',
        evidence: summarizeRelatedFindings(replicaFindings, 'Longhorn replica').slice(0, 8),
        count: inventory.replicasNotRunning,
        path: replicaFindings[0]?.path ?? null,
      }),
    );
  }

  if (inventory.nodesWithDiskIssues > 0) {
    findings.push(
      createFinding({
        id: 'harvester-longhorn-node-disk-issues',
        severity: nodeFindings.some((finding) => finding.severity === 'critical') ? 'critical' : 'warning',
        category: 'Harvester Storage',
        title: 'Longhorn node disks are not ready',
        description:
          'Longhorn reports node or disk readiness problems. Harvester VM volume replicas may not schedule or rebuild on affected nodes.',
        evidence: summarizeRelatedFindings(nodeFindings, 'Longhorn node').slice(0, 8),
        count: inventory.nodesWithDiskIssues,
        path: nodeFindings[0]?.path ?? null,
      }),
    );
  }

  if (schedulingFinding) {
    findings.push(
      createFinding({
        id: 'harvester-longhorn-replica-scheduling-storage',
        severity: schedulingFinding.severity,
        category: 'Harvester Storage',
        title: 'Longhorn replica scheduling is blocked by disk availability',
        description:
          'Longhorn manager logs show replica creation precheck failures related to unavailable disks, insufficient storage, or missing disks.',
        evidence: schedulingFinding.evidence ?? [],
        evidenceRefs: schedulingFinding.evidenceRefs ?? [],
        count: schedulingFinding.count,
        path: schedulingFinding.path,
      }),
    );
  }

  return {
    inventory,
    findings,
    longhornInventory: longhorn,
  };
}

async function analyzeHarvesterEvents(context) {
  const files = await Promise.all([
    readReportFile(context, `${HARVESTER_RESOURCE_ROOT}/v1/events.yaml`),
    readReportFile(context, `${HARVESTER_RESOURCE_ROOT}/events.k8s.io/v1/events.yaml`),
  ]);
  const inventory = {
    total: 0,
    warnings: 0,
  };
  const warningEvents = [];
  let firstPath = null;

  for (const file of files.filter(Boolean)) {
    firstPath ??= file.reportPath;
    const events = splitKubernetesItems(file.content);
    inventory.total += events.length;

    for (const event of events) {
      const type = readTopLevelScalar(event, 'type');

      if (type !== 'Warning') {
        continue;
      }

      const reason = readTopLevelScalar(event, 'reason') ?? 'Warning';
      const message = readTopLevelScalar(event, 'message') ?? readTopLevelScalar(event, 'note') ?? 'Warning event';
      inventory.warnings += 1;
      warningEvents.push(`${reason}: ${message}`);
    }
  }

  if (!warningEvents.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'harvester-warning-events',
        severity: 'warning',
        category: 'Kubernetes Events',
        title: 'Warning events found in harvester-system',
        description: 'Kubernetes recorded warning events in the Harvester namespace.',
        evidence: warningEvents.slice(0, 8),
        count: warningEvents.length,
        path: firstPath,
      }),
    ],
  };
}

async function analyzeHarvesterLogs(context) {
  const logConfig = await loadProductLogConfig('harvester', DEFAULT_LOG_CONFIG, {
    rulesDir: context.rulesDir,
  });
  const logEntries = context.index
    .filter((entry) => entry.type === 'file' && isHarvesterLogPath(entry.path, logConfig))
    .sort(
      (a, b) =>
        priorityForLogPath(a.path, logConfig.priorities) -
          priorityForLogPath(b.path, logConfig.priorities) ||
        a.path.localeCompare(b.path),
    )
    .slice(0, logConfig.maxFiles);
  const inventory = {
    scannedFiles: logEntries.length,
    matchedLines: 0,
  };
  const matchesByPattern = new Map(logConfig.patterns.map((pattern) => [pattern.id, {
    pattern,
    count: 0,
    evidence: [],
    evidenceRefs: [],
    path: null,
  }]));

  for (const entry of logEntries) {
    const sampledLines = await readLogLineSamples(context.extractDir, entry.path);

    if (!sampledLines.length) {
      continue;
    }

    for (const { line, lineNumber } of sampledLines) {
      for (const match of matchesByPattern.values()) {
        if (!match.pattern.test.test(line)) {
          continue;
        }

        match.count += 1;
        inventory.matchedLines += 1;
        match.path ??= entry.path;

        if (match.evidence.length < 5) {
          const excerpt = truncate(line, 240);
          match.evidence.push(`${shortenReportPath(entry.path)}:${lineNumber} ${excerpt}`);
          match.evidenceRefs.push({
            path: entry.path,
            lineStart: lineNumber,
            lineEnd: lineNumber,
            label: `${shortenReportPath(entry.path)}:${lineNumber}`,
            excerpt,
          });
        }
      }
    }
  }

  const findings = [...matchesByPattern.values()]
    .filter((match) => match.count > 0)
    .map((match) =>
      createFinding({
        id: match.pattern.id,
        severity: match.pattern.severity,
        category: match.pattern.category,
        title: match.pattern.title,
        description: match.pattern.description,
        evidence: match.evidence,
        evidenceRefs: match.evidenceRefs,
        count: match.count,
        path: match.path,
      }),
    );

  return { inventory, findings };
}

function hasLonghornStorageInventory(inventory) {
  return [
    inventory.volumes,
    inventory.replicas,
    inventory.nodes,
    inventory.unhealthyVolumes,
    inventory.replicasNotRunning,
    inventory.nodesWithDiskIssues,
    inventory.replicaSchedulingLogMatches,
  ].some((value) => Number.isFinite(value) && value > 0);
}

function summarizeRelatedFindings(findings, label) {
  return findings.map((finding) => {
    const evidence = finding.evidence?.[0];
    return compactEvidence([
      `${label}: ${finding.title}`,
      evidence,
    ]).join(' · ');
  });
}

function collectHarvesterAppVersions(content) {
  return splitKubernetesItems(content)
    .filter((item) => readMetadataName(item) === 'harvester')
    .map((item) => createVersionCandidate({
      version: normalizeVersion(extractChartVersion(item) ?? extractYamlScalar(item, 'app.kubernetes.io/version')),
      component: 'harvester',
      source: 'Harvester app chart',
      priority: 0,
    }))
    .filter(Boolean);
}

function collectHarvesterPodVersions(content) {
  return splitKubernetesItems(content)
    .filter((item) => item.includes('rancher/harvester:') || item.includes('app.kubernetes.io/name: harvester'))
    .flatMap((item) => [
      createVersionCandidate({
        version: normalizeVersion(extractYamlScalar(item, 'app.kubernetes.io/version')),
        component: 'harvester',
        source: 'Harvester pod label',
        priority: 1,
      }),
      createVersionCandidate({
        version: normalizeVersion(extractImageTag(item, /rancher\/harvester:([A-Za-z0-9_.-]+)/)),
        component: 'harvester-image',
        source: 'Harvester image',
        priority: 2,
      }),
      createVersionCandidate({
        version: normalizeVersion(extractYamlScalar(item, 'kubevirt.io/install-strategy-version')),
        component: 'kubevirt',
        source: 'KubeVirt pod label',
        priority: 4,
      }),
    ])
    .filter(Boolean);
}

function collectHarvesterAddonVersions(content) {
  return splitKubernetesItems(content)
    .map((item) => {
      const name = readMetadataName(item);
      const spec = topLevelSection(item, 'spec');

      return createVersionCandidate({
        version: normalizeVersion(readScalar(spec, 'version')),
        component: name ? `addon/${name}` : 'addon',
        source: 'Harvester addon spec',
        priority: 6,
      });
    })
    .filter(Boolean);
}

function collectHarvesterAvailableVersions(content) {
  return splitKubernetesItems(content)
    .map((item) => createVersionCandidate({
      version: normalizeVersion(readMetadataName(item)),
      component: 'available-version',
      source: 'Harvester Version resource',
      priority: 8,
    }))
    .filter(Boolean);
}

async function readReportFile({ extractDir, index }, suffix) {
  const normalizedSuffix = normalizeReportPath(suffix);
  const entry = index.find(
    (candidate) =>
      candidate.type === 'file' &&
      normalizeReportPath(candidate.path).endsWith(normalizedSuffix),
  );

  if (!entry) {
    return null;
  }

  const filePath = safeResolve(extractDir, entry.path);
  const content = await fs.readFile(filePath, 'utf8');

  return {
    content,
    reportPath: entry.path,
  };
}

async function readReportFilesBySuffix({ extractDir, index }, suffix) {
  const normalizedSuffix = normalizeReportPath(suffix);
  const entries = index.filter(
    (candidate) =>
      candidate.type === 'file' &&
      normalizeReportPath(candidate.path).endsWith(normalizedSuffix),
  );
  const files = [];

  for (const entry of entries) {
    const filePath = safeResolve(extractDir, entry.path);
    files.push({
      content: await fs.readFile(filePath, 'utf8'),
      reportPath: entry.path,
    });
  }

  return files;
}

async function readLogLineSamples(rootDir, reportPath) {
  const filePath = safeResolve(rootDir, reportPath);
  const stats = await fs.stat(filePath);
  const handle = await fs.open(filePath, 'r');

  try {
    if (stats.size <= LOG_SAMPLE_BYTES * 2) {
      return linesWithNumbers(await fs.readFile(filePath, 'utf8'), 1);
    }

    const head = Buffer.alloc(LOG_SAMPLE_BYTES);
    const tail = Buffer.alloc(LOG_SAMPLE_BYTES);
    const tailStart = stats.size - LOG_SAMPLE_BYTES;
    await handle.read(head, 0, LOG_SAMPLE_BYTES, 0);
    await handle.read(tail, 0, LOG_SAMPLE_BYTES, tailStart);
    const tailLineInfo = await tailLineInfoAfterByte(filePath, tailStart);
    const headLines = linesWithNumbers(head.toString('utf8'), 1);
    const tailLines = linesWithNumbers(tail.toString('utf8'), tailLineInfo.firstLineNumber, {
      dropFirstLine: tailLineInfo.dropFirstLine,
    });

    return [...headLines, ...tailLines];
  } finally {
    await handle.close();
  }
}

function linesWithNumbers(content, firstLineNumber, { dropFirstLine = false } = {}) {
  const lines = content.split(/\r?\n/);
  const offset = dropFirstLine ? 1 : 0;

  return lines
    .slice(offset)
    .filter((line) => line)
    .map((line, index) => ({
      line,
      lineNumber: firstLineNumber + offset + index,
    }));
}

async function tailLineInfoAfterByte(filePath, byteOffset) {
  if (byteOffset <= 0) {
    return {
      firstLineNumber: 1,
      dropFirstLine: false,
    };
  }

  const handle = await fs.open(filePath, 'r');
  const buffer = Buffer.alloc(64 * 1024);
  const previousByte = Buffer.alloc(1);
  let position = 0;
  let newlineCount = 0;

  try {
    while (position < byteOffset) {
      const length = Math.min(buffer.length, byteOffset - position);
      const { bytesRead } = await handle.read(buffer, 0, length, position);

      if (!bytesRead) {
        break;
      }

      for (let index = 0; index < bytesRead; index += 1) {
        if (buffer[index] === 10) {
          newlineCount += 1;
        }
      }

      position += bytesRead;
    }

    await handle.read(previousByte, 0, 1, byteOffset - 1);
  } finally {
    await handle.close();
  }

  const startsAtLineBoundary = previousByte[0] === 10;

  return {
    firstLineNumber: newlineCount + 1,
    dropFirstLine: !startsAtLineBoundary,
  };
}

function splitKubernetesItems(content) {
  const items = [];
  let current = [];

  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith('- apiVersion:')) {
      if (current.length) {
        items.push(current.join('\n'));
      }

      current = [line];
      continue;
    }

    if (current.length) {
      current.push(line);
    }
  }

  if (current.length) {
    items.push(current.join('\n'));
  }

  return items;
}

function topLevelSection(block, sectionName) {
  const lines = block.split(/\r?\n/);
  const startIndex = lines.findIndex((line) => line === `  ${sectionName}:`);

  if (startIndex === -1) {
    return '';
  }

  const sectionLines = [];

  for (let index = startIndex + 1; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^  [A-Za-z0-9_-]+:/.test(line)) {
      break;
    }

    sectionLines.push(line);
  }

  return sectionLines.join('\n');
}

function readMetadataName(block) {
  return readScalar(topLevelSection(block, 'metadata'), 'name');
}

function readMetadataNamespace(block) {
  return readScalar(topLevelSection(block, 'metadata'), 'namespace');
}

function readResourceDisplayName(block) {
  const name = readMetadataName(block);
  const namespace = readMetadataNamespace(block);

  if (!name) {
    return null;
  }

  return namespace ? `${namespace}/${name}` : name;
}

function readTopLevelScalar(block, key) {
  const match = block.match(new RegExp(`^  ${escapeRegExp(key)}:\\s*(.*)$`, 'm'));
  return match ? cleanScalar(match[1]) : null;
}

function readScalar(section, key) {
  const match = section.match(new RegExp(`^    ${escapeRegExp(key)}:\\s*(.*)$`, 'm'));
  return match ? cleanScalar(match[1]) : null;
}

function extractYamlScalar(block, key) {
  const match = block.match(new RegExp(`^\\s+${escapeRegExp(key)}:\\s*(.*)$`, 'm'));
  return match ? cleanScalar(match[1]) : null;
}

function namespaceFromReportPath(reportPath) {
  const match = normalizeReportPath(reportPath).match(/\/yamls\/namespaced\/([^/]+)\//);
  return match ? match[1] : 'default';
}

function workloadKey(namespace, name) {
  return `${namespace || 'default'}/${name || 'unknown'}`;
}

function extractNodeSelectorValues(section) {
  const values = [];
  const lines = section.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const selectorMatch = lines[index].match(/^(\s*)nodeSelector:\s*$/);

    if (!selectorMatch) {
      continue;
    }

    const selectorIndent = selectorMatch[1].length;

    for (index += 1; index < lines.length; index += 1) {
      const line = lines[index];

      if (!line.trim()) {
        continue;
      }

      const lineIndent = line.match(/^(\s*)/)?.[1].length ?? 0;

      if (lineIndent <= selectorIndent) {
        index -= 1;
        break;
      }

      const valueMatch = line.match(/^\s+(?:kubernetes\.io\/hostname|hostname|nodeName):\s*(.*)$/);

      if (valueMatch) {
        values.push(cleanScalar(valueMatch[1]));
      }
    }
  }

  return uniqueValues(values);
}

function extractReferencedImageNames(block) {
  const values = [];

  for (const match of block.matchAll(/^\s+(?:imageName|imageID|imageId|virtualMachineImageName):\s*(.*)$/gm)) {
    values.push(cleanScalar(match[1]));
  }

  return uniqueValues(values);
}

function extractVmNetworkNames(block) {
  const values = [];

  for (const match of block.matchAll(/^\s+networkName:\s*(.*)$/gm)) {
    const value = cleanScalar(match[1]);
    values.push(value);

    if (value?.includes('/')) {
      values.push(value.split('/').at(-1));
    }
  }

  return uniqueValues(values);
}

function readEventObjectRef(event) {
  for (const sectionName of ['involvedObject', 'regarding', 'related']) {
    const section = topLevelSection(event, sectionName);

    if (!section) {
      continue;
    }

    const name = readScalar(section, 'name');

    if (!name) {
      continue;
    }

    return {
      kind: readScalar(section, 'kind'),
      name,
      namespace: readScalar(section, 'namespace'),
    };
  }

  return {};
}

function matchImagesToWorkload(vm, images) {
  if (!vm) {
    return [];
  }

  const text = vm.sourceText.toLowerCase();
  const explicitNames = new Set(vm.imageNames.map((name) => name.toLowerCase()));

  return images.filter((image) => {
    if (image.namespace && image.namespace !== vm.namespace) {
      return false;
    }

    const names = [image.name, image.displayName].filter(Boolean).map((name) => String(name).toLowerCase());
    return names.some((name) => explicitNames.has(name) || text.includes(name));
  });
}

function matchNetworksToWorkload({ vm, vmi, migrations, networks }) {
  const networkNames = new Set((vm?.networkNames ?? []).map((name) => String(name).toLowerCase()));
  const nodeNames = new Set(
    uniqueValues([
      vm?.nodeName,
      vmi?.nodeName,
      ...(vm?.desiredNodeNames ?? []),
      ...migrations.flatMap((migration) => [migration.sourceNode, migration.targetNode]),
    ]).map((name) => String(name).toLowerCase()),
  );

  return networks.filter((network) => {
    const candidates = uniqueValues([network.name, network.clusterNetwork, network.vlanConfig]).map((name) =>
      String(name).toLowerCase(),
    );

    return (
      candidates.some((name) => networkNames.has(name) || networkNames.has(name.split('/').at(-1))) ||
      (network.node && nodeNames.has(network.node.toLowerCase()))
    );
  });
}

function eventMatchesWorkload(event, workload) {
  if (event.namespace && event.namespace !== workload.namespace) {
    return false;
  }

  const names = uniqueValues([
    workload.name,
    workload.vm?.name,
    workload.vmi?.name,
    ...(workload.migrations ?? []).map((migration) => migration.name),
  ]);

  if (event.involvedName && names.includes(event.involvedName)) {
    return true;
  }

  const text = `${event.reason} ${event.message}`.toLowerCase();
  return names.some((name) => text.includes(String(name).toLowerCase()));
}

function logReferenceMatchesWorkload(ref, workload) {
  const text = `${ref.excerpt ?? ''} ${ref.evidence ?? ''}`.toLowerCase();
  const names = uniqueValues([workload.name, `${workload.namespace}/${workload.name}`]);
  return names.some((name) => text.includes(String(name).toLowerCase()));
}

function extractChartVersion(block) {
  const chartIndex = block.indexOf('\n    chart:');

  if (chartIndex === -1) {
    return null;
  }

  const chartBlock = block.slice(chartIndex);
  const match = chartBlock.match(/^\s+version:\s*(.*)$/m);
  return match ? cleanScalar(match[1]) : null;
}

function extractImageTag(block, pattern) {
  const match = block.match(pattern);
  return match ? cleanScalar(match[1]) : null;
}

function extractNtpStatus(metadataSection) {
  const value = extractYamlScalar(metadataSection, 'node.harvesterhci.io/ntp-service');

  if (!value) {
    return null;
  }

  const jsonMatch = value.match(/"ntpSyncStatus"\s*:\s*"([^"]+)"/);

  if (jsonMatch) {
    return jsonMatch[1];
  }

  const looseMatch = value.match(/ntpSyncStatus['"]?\s*[:=]\s*['"]?([A-Za-z0-9_-]+)/);
  return looseMatch ? looseMatch[1] : value;
}

function extractConditions(section) {
  const conditions = [];
  const lines = section.split(/\r?\n/);
  let inConditions = false;
  let current = null;
  let lastKey = null;

  for (const line of lines) {
    if (line === '    conditions:') {
      inConditions = true;
      continue;
    }

    if (!inConditions) {
      continue;
    }

    if (/^    [A-Za-z0-9_-]+:/.test(line) && current) {
      conditions.push(current);
      break;
    }

    if (line.startsWith('    - ')) {
      if (current) {
        conditions.push(current);
      }

      current = {};
      lastKey = null;
      readInlineListScalar(line, current, (key) => {
        lastKey = key;
      });
      continue;
    }

    const match = line.match(/^      ([A-Za-z0-9_-]+):\s*(.*)$/);

    if (current && match) {
      current[match[1]] = cleanScalar(match[2]);
      lastKey = match[1];
      continue;
    }

    if (current && lastKey && line.startsWith('        ')) {
      current[lastKey] = `${current[lastKey]} ${line.trim()}`.trim();
    }
  }

  if (inConditions && current && !conditions.includes(current)) {
    conditions.push(current);
  }

  return conditions.filter((condition) => condition.type);
}

function extractContainerRestarts(section) {
  const containers = [];
  const lines = section.split(/\r?\n/);
  let inStatuses = false;
  let current = null;

  for (const line of lines) {
    if (line === '    containerStatuses:' || line === '    initContainerStatuses:') {
      if (current) {
        containers.push(current);
      }

      inStatuses = true;
      current = null;
      continue;
    }

    if (!inStatuses) {
      continue;
    }

    if (/^    [A-Za-z0-9_-]+:/.test(line) && current) {
      containers.push(current);
      current = null;
      inStatuses = false;
      continue;
    }

    if (line.startsWith('    - ')) {
      if (current) {
        containers.push(current);
      }

      current = {};
      readInlineListScalar(line, current);
      continue;
    }

    const match = line.match(/^      ([A-Za-z0-9_-]+):\s*(.*)$/);

    if (current && match) {
      const value = cleanScalar(match[2]);
      current[match[1]] = match[1] === 'restartCount' ? Number.parseInt(value, 10) || 0 : value;
    }
  }

  if (current) {
    containers.push(current);
  }

  return containers;
}

function readInlineListScalar(line, target, onKey = () => undefined) {
  const inline = line.slice('    - '.length);
  const match = inline.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);

  if (!match) {
    return;
  }

  target[match[1]] = cleanScalar(match[2]);
  onKey(match[1]);
}

function isHarvesterLogPath(reportPath, logConfig) {
  const normalized = normalizeReportPath(reportPath);

  if (!/\.(log|log\.\d+|\d+)$/.test(normalized)) {
    return false;
  }

  return isIncludedLogPath(normalized, logConfig.include);
}

function createVersionCandidate({ version, component, source, priority }) {
  if (!version) {
    return null;
  }

  return {
    version,
    component,
    source,
    priority,
  };
}

function uniqueVersionCandidates(candidates) {
  const seen = new Set();
  const unique = [];

  for (const candidate of candidates.sort((a, b) => a.priority - b.priority)) {
    const key = `${candidate.component}:${candidate.version}:${candidate.source}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    unique.push({
      component: candidate.component,
      version: candidate.version,
      source: candidate.source,
      path: candidate.path,
    });
  }

  return unique;
}

function normalizeVersion(value) {
  const version = cleanScalar(value);

  if (!version) {
    return null;
  }

  return /^\d/.test(version) ? `v${version}` : version;
}

function createFinding({
  id,
  severity,
  category,
  title,
  description,
  evidence = [],
  evidenceRefs = [],
  count = null,
  path = null,
}) {
  return {
    id,
    severity,
    category,
    title,
    description,
    evidence,
    evidenceRefs,
    count,
    path,
  };
}

function createFindingGroup({
  id,
  severity,
  title,
  description,
  impact,
  affected = [],
  recommendedChecks = [],
  evidence = [],
  relatedFindingIds = [],
}) {
  return {
    id,
    severity,
    title,
    description,
    impact,
    affected,
    recommendedChecks,
    evidence,
    relatedFindingIds,
  };
}

function conditionFacts({ name, condition }) {
  return {
    name,
    nameSlug: slugify(name),
    'condition.type': condition.type,
    'condition.typeSlug': slugify(condition.type),
    'condition.status': condition.status,
    'condition.reason': condition.reason,
    'condition.message': condition.message,
  };
}

function createConditionRuleFinding(context, resource, facts, reportPath) {
  const rule = findConditionRule(context.conditionRules ?? [], resource, facts);

  if (!rule) {
    return null;
  }

  return createFinding({
    ...buildConditionFinding(rule, facts),
    path: reportPath,
  });
}

function compactEvidence(values) {
  return values.filter(Boolean).map((value) => String(value));
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => Boolean(entry)),
  );
}

function uniqueValues(values) {
  return [...new Set(values.filter(Boolean).map((value) => String(value)))];
}

function dedupeFindings(findings) {
  const seen = new Set();
  const deduped = [];

  for (const finding of findings) {
    if (seen.has(finding.id)) {
      continue;
    }

    seen.add(finding.id);
    deduped.push(finding);
  }

  return deduped;
}

function sortFindings(findings) {
  const severityRank = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return [...findings].sort(
    (a, b) =>
      severityRank[a.severity] - severityRank[b.severity] ||
      a.category.localeCompare(b.category) ||
      a.title.localeCompare(b.title),
  );
}

function sortFindingGroups(groups) {
  const severityRank = {
    critical: 0,
    warning: 1,
    info: 2,
  };

  return [...groups].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity] || a.title.localeCompare(b.title),
  );
}

function findFinding(findings, id) {
  return findings.find((finding) => finding.id === id) ?? null;
}

function findingIds(findings) {
  return findings
    .filter(Boolean)
    .map((finding) => finding.id);
}

function highestSeverity(findings) {
  const severities = findings
    .filter(Boolean)
    .map((finding) => finding.severity);

  if (severities.includes('critical')) {
    return 'critical';
  }

  if (severities.includes('warning')) {
    return 'warning';
  }

  return 'info';
}

function severityRank(severity) {
  return {
    critical: 0,
    warning: 1,
    info: 2,
  }[severity] ?? 3;
}

function mergeEvidence(findings) {
  const evidence = [];

  for (const finding of findings.filter(Boolean)) {
    if (finding.count && finding.count > 1) {
      evidence.push(`${finding.title}: ${finding.count} matches`);
    }

    if (finding.evidence?.length) {
      evidence.push(...finding.evidence);
    } else if (finding.path) {
      evidence.push(`${finding.title}: ${finding.path}`);
    }
  }

  return [...new Set(evidence)].slice(0, 10);
}

function affectedMetric(label, value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return `${label}: ${value}`;
}

function safeResolve(rootDir, reportPath) {
  const resolved = path.resolve(rootDir, reportPath);
  const relative = path.relative(rootDir, resolved);

  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    throw new Error(`Resolved report path escapes the extraction directory: ${reportPath}`);
  }

  return resolved;
}

function normalizeReportPath(value) {
  return String(value).replaceAll('\\', '/');
}

function shortenReportPath(value) {
  const normalized = normalizeReportPath(value);
  const logsIndex = normalized.indexOf('/logs/');

  if (logsIndex !== -1) {
    return normalized.slice(logsIndex + 1);
  }

  return normalized;
}

function cleanScalar(value) {
  let clean = String(value ?? '').trim();

  if (
    (clean.startsWith('"') && clean.endsWith('"')) ||
    (clean.startsWith("'") && clean.endsWith("'"))
  ) {
    clean = clean.slice(1, -1);
  }

  if (clean === 'null') {
    return null;
  }

  return clean;
}

function parseBoolean(value) {
  const normalized = String(value ?? '').toLowerCase();

  if (normalized === 'true') {
    return true;
  }

  if (normalized === 'false') {
    return false;
  }

  return null;
}

function isVmDesiredRunning({ running, runStrategy }) {
  if (running !== null) {
    return running;
  }

  if (!runStrategy) {
    return false;
  }

  return !['halted', 'manual'].includes(runStrategy.toLowerCase());
}

function vmIssueReason({ printableStatus, desiredRunning, ready, created }) {
  const status = String(printableStatus ?? '').trim();

  if (status && isProblemVmStatus(status)) {
    return status;
  }

  if (desiredRunning && status && !isAcceptableDesiredVmStatus(status)) {
    return `desired running but status is ${status}`;
  }

  if (desiredRunning && created === false) {
    return 'desired running but VMI is not created';
  }

  if (desiredRunning && ready && ready.status !== 'True') {
    return `Ready=${ready.status}`;
  }

  return null;
}

function isProblemVmStatus(status) {
  return /unschedulable|error|failed|crashloop|imagepull|pvcnotfound|datavolume|waitingforvolumebinding|waitingforreceiver/i.test(
    status,
  );
}

function isAcceptableDesiredVmStatus(status) {
  return /^(running|starting|migrating|provisioning)$/i.test(status);
}

function isRunningStatus(status) {
  return /^running$/i.test(String(status ?? ''));
}

function isStoppedStatus(status) {
  return /^(stopped|stopping|halted)$/i.test(String(status ?? ''));
}

function slugify(value) {
  return String(value ?? 'unknown')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function truncate(value, maxLength) {
  const text = String(value);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 1)}...`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
