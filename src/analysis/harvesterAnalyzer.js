import fs from 'node:fs/promises';
import path from 'node:path';

const HARVESTER_RESOURCE_ROOT = 'yamls/namespaced/harvester-system';
const MAX_FINDINGS_PER_RULE = 12;
const MAX_LOG_FILES = 80;
const LOG_SAMPLE_BYTES = 256 * 1024;

const NODE_TRUE_CONDITIONS = new Set(['Ready', 'EtcdIsVoter']);
const NODE_FALSE_CONDITIONS = new Set([
  'MemoryPressure',
  'DiskPressure',
  'PIDPressure',
  'NetworkUnavailable',
]);

const LOG_PATTERNS = [
  {
    id: 'harvester-log-webhook-errors',
    severity: 'warning',
    category: 'Harvester Logs',
    title: 'Harvester webhooks returned errors',
    description:
      'Harvester or KubeVirt logs contain webhook failures. These can block node updates, VM lifecycle operations, or API admission requests.',
    test: /failed calling webhook|validator\.harvesterhci\.io|webhook.*(connection refused|bad gateway|no endpoints)|502 Bad Gateway/i,
  },
  {
    id: 'harvester-log-virtualization-scheduling',
    severity: 'warning',
    category: 'Virtualization',
    title: 'Virtualization logs contain scheduling or migration errors',
    description:
      'KubeVirt or scheduler logs contain unschedulable, node selector, or migration-related messages that can explain VM placement failures.',
    test: /failed to mark node as unschedulable|unschedulable|nodeSelector|node selector|didn.?t match|0\/\d+ nodes are available|live.?migration|migration.*failed/i,
  },
  {
    id: 'harvester-log-network-offload',
    severity: 'warning',
    category: 'Harvester Network',
    title: 'Network logs mention offload settings',
    description:
      'Harvester network logs mention GRO, GSO, offload, or ethtool. These lines are worth reviewing when VM network throughput or packet handling is under investigation.',
    test: /\b(GRO|GSO)\b|ethtool|ChecksumOffloadBroken:true|(?:disable|disabled|enable|enabled|rx|tx).*offload|offload.*(?:disable|disabled|enable|enabled|GRO|GSO|rx|tx)/i,
  },
  {
    id: 'harvester-log-error-lines',
    severity: 'warning',
    category: 'Harvester Logs',
    title: 'Harvester platform logs contain error-level lines',
    description:
      'One or more Harvester platform log files contain error-level messages. Review the evidence lines for the first matching files.',
    test: /\blevel=error\b|\bE\d{4}\b|Unhandled Error/i,
  },
];

export async function analyzeHarvesterSupportBundle({ extractDir, index }) {
  const context = { extractDir, index };
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

  const networkAnalysis = await analyzeHarvesterNetwork(context);
  inventory.harvester.networks = networkAnalysis.inventory;
  findings.push(...networkAnalysis.findings);

  const eventAnalysis = await analyzeHarvesterEvents(context);
  inventory.harvester.events = eventAnalysis.inventory;
  findings.push(...eventAnalysis.findings);

  const logAnalysis = await analyzeHarvesterLogs(context);
  inventory.harvester.logs = logAnalysis.inventory;
  findings.push(...logAnalysis.findings);

  const sortedFindings = sortFindings(dedupeFindings(findings));
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
  const networkFindings = findings.filter((finding) => finding.category === 'Harvester Network');
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
      const expectedStatus = expectedNodeConditionStatus(condition.type);

      if (!expectedStatus || condition.status === expectedStatus) {
        continue;
      }

      nodeHasIssue = true;

      if (condition.type === 'Ready') {
        inventory.notReady += 1;
      } else if (NODE_FALSE_CONDITIONS.has(condition.type)) {
        inventory.pressure += 1;
      }

      findings.push(
        createFinding({
          id: `harvester-node-${slugify(name)}-${slugify(condition.type)}`,
          severity: condition.type === 'Ready' ? 'critical' : 'warning',
          category: 'Harvester Node',
          title: `Node ${name} has ${condition.type} issue`,
          description: 'A Harvester node readiness, pressure, or cluster membership condition is not in the expected state.',
          evidence: conditionEvidence(condition),
          path: file.reportPath,
        }),
      );
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
  const logEntries = context.index
    .filter((entry) => entry.type === 'file' && isHarvesterLogPath(entry.path))
    .sort((a, b) => logPriority(a.path) - logPriority(b.path) || a.path.localeCompare(b.path))
    .slice(0, MAX_LOG_FILES);
  const inventory = {
    scannedFiles: logEntries.length,
    matchedLines: 0,
  };
  const matchesByPattern = new Map(LOG_PATTERNS.map((pattern) => [pattern.id, {
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

function expectedNodeConditionStatus(type) {
  if (NODE_TRUE_CONDITIONS.has(type)) {
    return 'True';
  }

  if (NODE_FALSE_CONDITIONS.has(type)) {
    return 'False';
  }

  return null;
}

function isHarvesterLogPath(reportPath) {
  const normalized = normalizeReportPath(reportPath);

  if (!/\.(log|log\.\d+|\d+)$/.test(normalized)) {
    return false;
  }

  if (normalized.includes('/logs/harvester-system/')) {
    return true;
  }

  return /\/logs\/kube-system\/(kube-scheduler|kube-proxy|rke2-multus|harvester-whereabouts|rke2-canal)-/.test(normalized);
}

function logPriority(reportPath) {
  const normalized = normalizeReportPath(reportPath);

  if (normalized.includes('/harvester-b')) {
    return 0;
  }

  if (normalized.includes('/harvester-webhook') || normalized.includes('/virt-')) {
    return 1;
  }

  if (normalized.includes('/cdi-')) {
    return 2;
  }

  if (normalized.includes('/harvester-network') || normalized.includes('/kube-vip')) {
    return 3;
  }

  if (normalized.includes('/kube-scheduler') || normalized.includes('/kube-proxy')) {
    return 4;
  }

  return 5;
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

function conditionEvidence(condition) {
  return compactEvidence([
    `Type: ${condition.type}`,
    condition.status ? `Status: ${condition.status}` : null,
    condition.reason ? `Reason: ${condition.reason}` : null,
    condition.message ? `Message: ${condition.message}` : null,
  ]);
}

function compactEvidence(values) {
  return values.filter(Boolean).map((value) => String(value));
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
