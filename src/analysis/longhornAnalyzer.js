import fs from 'node:fs/promises';
import path from 'node:path';

const LONGHORN_RESOURCE_ROOT = 'yamls/namespaced/longhorn-system';
const MAX_FINDINGS_PER_RULE = 10;
const MAX_LOG_FILES = 40;
const LOG_SAMPLE_BYTES = 256 * 1024;

const NODE_TRUE_CONDITIONS = new Set([
  'Ready',
  'Schedulable',
  'MountPropagation',
  'NFSClientInstalled',
  'RequiredPackages',
  'KernelModulesLoaded',
]);

const VOLUME_TRUE_PROBLEM_CONDITIONS = new Set([
  'Restore',
  'TooManySnapshots',
  'WaitForBackingImage',
]);

const REPLICA_TRUE_PROBLEM_CONDITIONS = new Set([
  'FilesystemReadOnly',
  'RebuildFailed',
]);

const LOG_PATTERNS = [
  {
    id: 'longhorn-manager-observed-panic',
    severity: 'critical',
    category: 'Longhorn Logs',
    title: 'Longhorn manager observed panics',
    description:
      'Longhorn manager logs contain Kubernetes runtime panic entries. This is a strong signal to inspect manager stability and the surrounding stack trace.',
    test: /observed a panic|panic\.go:\d+|panic=/i,
  },
  {
    id: 'longhorn-log-replica-scheduling-storage',
    severity: 'warning',
    category: 'Longhorn Logs',
    title: 'Replica scheduling is hitting storage pressure',
    description:
      'Longhorn manager logs contain replica creation precheck failures related to insufficient disk space or unavailable disks.',
    test: /precheck failed.*replica|insufficient storage|does not have enough storage|no disks found/i,
  },
  {
    id: 'longhorn-log-csi-connection-refused',
    severity: 'warning',
    category: 'Longhorn Logs',
    title: 'CSI components saw connection refused errors',
    description:
      'Longhorn CSI logs contain connection refused errors, which can happen while CSI sockets or sidecars are not ready.',
    test: /\/csi\/csi\.sock.*connection refused/i,
  },
  {
    id: 'longhorn-log-webhook-connection-refused',
    severity: 'warning',
    category: 'Longhorn Logs',
    title: 'Longhorn webhook endpoints saw connection refused errors',
    description:
      'Longhorn manager logs contain failed health checks for local webhook endpoints. This can happen while conversion or admission webhooks are not ready.',
    test: /localhost:950[12]\/v1\/healthz.*connection refused|failed to check endpoint https:\/\/localhost:950[12]\/v1\/healthz/i,
  },
  {
    id: 'longhorn-log-error-lines',
    severity: 'warning',
    category: 'Longhorn Logs',
    title: 'Longhorn logs contain error-level lines',
    description:
      'One or more Longhorn log files contain error-level messages. Review the evidence lines for the first matching files.',
    test: /\blevel=error\b|\bE\d{4}\b/i,
  },
];

export async function analyzeLonghornSupportBundle({ extractDir, index }) {
  const context = { extractDir, index };
  const findings = [];
  const inventory = {
    metadata: {},
    longhorn: {},
  };

  inventory.metadata = await readSupportBundleMetadata(context);
  const collectionFinding = await analyzeBundleGenerationErrors(context);

  if (collectionFinding) {
    findings.push(collectionFinding);
  }

  findings.push(...(await analyzePrometheusAlerts(context)));

  const volumeAnalysis = await analyzeVolumes(context);
  inventory.longhorn.volumes = volumeAnalysis.inventory;
  findings.push(...volumeAnalysis.findings);

  const replicaAnalysis = await analyzeReplicas(context);
  inventory.longhorn.replicas = replicaAnalysis.inventory;
  findings.push(...replicaAnalysis.findings);

  const nodeAnalysis = await analyzeLonghornNodes(context);
  inventory.longhorn.nodes = nodeAnalysis.inventory;
  findings.push(...nodeAnalysis.findings);

  const podAnalysis = await analyzeLonghornPods(context);
  inventory.longhorn.pods = podAnalysis.inventory;
  findings.push(...podAnalysis.findings);

  const eventAnalysis = await analyzeLonghornEvents(context);
  inventory.longhorn.events = eventAnalysis.inventory;
  findings.push(...eventAnalysis.findings);

  const logAnalysis = await analyzeLonghornLogs(context);
  inventory.longhorn.logs = logAnalysis.inventory;
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
  const longhorn = inventory.longhorn ?? {};
  const collectionFinding = findFinding(findings, 'longhorn-bundle-generation-errors');
  const panicFinding = findFinding(findings, 'longhorn-manager-observed-panic');
  const errorLogFinding = findFinding(findings, 'longhorn-log-error-lines');
  const storageFinding = findFinding(findings, 'longhorn-log-replica-scheduling-storage');
  const webhookFinding = findFinding(findings, 'longhorn-log-webhook-connection-refused');
  const csiFinding = findFinding(findings, 'longhorn-log-csi-connection-refused');
  const nodeFindings = findings.filter((finding) => finding.category === 'Longhorn Node');
  const volumeFindings = findings.filter((finding) => finding.category === 'Longhorn Volume');
  const replicaFindings = findings.filter((finding) => finding.category === 'Longhorn Replica');
  const podRestartFinding = findFinding(findings, 'longhorn-pods-with-container-restarts');
  const monitoringFindings = findings.filter((finding) => finding.category === 'Monitoring');

  if (panicFinding || errorLogFinding) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-manager-stability',
        severity: highestSeverity([panicFinding, errorLogFinding]),
        title: panicFinding ? 'Longhorn manager stability needs attention' : 'Longhorn manager logs contain errors',
        description:
          'Longhorn manager is the main reconciliation loop. Panics or sustained error logs can explain stale volume, replica, or instance-manager state.',
        impact:
          'Management operations may fail or lag, and secondary symptoms can appear across volumes, replicas, and webhooks.',
        affected: compactEvidence([
          panicFinding ? affectedMetric('Panics', panicFinding.count) : null,
          errorLogFinding ? affectedMetric('Error lines', errorLogFinding.count) : null,
          longhorn.logs?.scannedFiles ? affectedMetric('Log files scanned', longhorn.logs.scannedFiles) : null,
        ]),
        recommendedChecks: [
          'Inspect the panic stack traces and the first surrounding manager log lines.',
          'Compare the Longhorn manager image/version against known issues for that release.',
          'Check whether node or webhook readiness findings happened at the same time.',
        ],
        evidence: mergeEvidence([panicFinding, errorLogFinding]),
        relatedFindingIds: findingIds([panicFinding, errorLogFinding]),
      }),
    );
  }

  if (longhorn.volumes?.unhealthy || longhorn.replicas?.notRunning) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-volume-replica-health',
        severity: highestSeverity([...volumeFindings, ...replicaFindings]),
        title: 'Volume and replica health are correlated',
        description:
          'Longhorn reports unhealthy volumes or replicas that are not running. These are usually related and should be investigated together.',
        impact:
          'Affected workloads may see degraded redundancy, attach problems, or recovery operations that cannot finish.',
        affected: compactEvidence([
          affectedMetric('Unhealthy volumes', longhorn.volumes?.unhealthy),
          affectedMetric('Replicas not running', longhorn.replicas?.notRunning),
          affectedMetric('Total volumes', longhorn.volumes?.total),
          affectedMetric('Total replicas', longhorn.replicas?.total),
        ]),
        recommendedChecks: [
          'Open the listed volume and replica YAML evidence together.',
          'Confirm whether the stopped replicas belong to the unhealthy volumes.',
          'Check node scheduling, disk capacity, and replica rebuild events before forcing recovery.',
        ],
        evidence: mergeEvidence([...volumeFindings, ...replicaFindings]),
        relatedFindingIds: findingIds([...volumeFindings, ...replicaFindings]),
      }),
    );
  }

  if (storageFinding) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-replica-scheduling-capacity',
        severity: storageFinding.severity,
        title: 'Replica scheduling is constrained by capacity or disk availability',
        description:
          'Manager logs show replica creation prechecks failing because candidate disks or nodes were not usable.',
        impact:
          'Longhorn may be unable to restore the desired replica count, keeping volumes degraded or rebuilds stuck.',
        affected: compactEvidence([
          affectedMetric('Scheduling log matches', storageFinding.count),
          affectedMetric('Replicas not running', longhorn.replicas?.notRunning),
          affectedMetric('Problematic nodes', longhorn.nodes?.problematic),
        ]),
        recommendedChecks: [
          'Review free space, reserved space, disk tags, node selectors, and disabled scheduling on Longhorn nodes.',
          'Compare the affected volume size with available disk capacity on candidate nodes.',
          'Resolve node prerequisite findings before retrying replica scheduling.',
        ],
        evidence: mergeEvidence([storageFinding]),
        relatedFindingIds: findingIds([storageFinding]),
      }),
    );
  }

  if (nodeFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-node-prerequisites',
        severity: highestSeverity(nodeFindings),
        title: 'Longhorn node prerequisites are not satisfied',
        description:
          'One or more Longhorn node conditions indicate missing packages, missing kernel modules, readiness problems, or host services that affect Longhorn.',
        impact:
          'Longhorn may avoid scheduling replicas on those nodes, fail storage operations, or report degraded redundancy.',
        affected: compactEvidence([
          affectedMetric('Problematic nodes', longhorn.nodes?.problematic),
          affectedMetric('Total Longhorn nodes', longhorn.nodes?.total),
          affectedMetric('Node findings', nodeFindings.length),
        ]),
        recommendedChecks: [
          'Install or repair the missing required packages reported in nodes.yaml.',
          'Load required kernel modules or adjust Longhorn settings if the feature is intentionally unused.',
          'Investigate multipathd findings before attaching or rebuilding volumes on affected nodes.',
        ],
        evidence: mergeEvidence(nodeFindings),
        relatedFindingIds: findingIds(nodeFindings),
      }),
    );
  }

  if (webhookFinding || csiFinding) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-control-plane-endpoints',
        severity: highestSeverity([webhookFinding, csiFinding]),
        title: 'Longhorn control-plane endpoints had connection failures',
        description:
          'Logs show local webhook or CSI socket connection failures. These often occur during startup, but repeated matches can affect reconciliation and Kubernetes storage calls.',
        impact:
          'Admission, conversion, or CSI operations may temporarily fail until the related endpoint becomes healthy.',
        affected: compactEvidence([
          webhookFinding ? affectedMetric('Webhook matches', webhookFinding.count) : null,
          csiFinding ? affectedMetric('CSI socket matches', csiFinding.count) : null,
        ]),
        recommendedChecks: [
          'Check whether the endpoint errors align with pod restarts or manager startup windows.',
          'Verify webhook and CSI sidecar pods are Ready after the error window.',
        ],
        evidence: mergeEvidence([webhookFinding, csiFinding]),
        relatedFindingIds: findingIds([webhookFinding, csiFinding]),
      }),
    );
  }

  if (podRestartFinding) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-pod-restarts',
        severity: podRestartFinding.severity,
        title: 'Longhorn pods restarted during the captured window',
        description:
          'Non-zero restart counts can explain transient connection errors, missing logs, or control-plane churn.',
        impact:
          'Repeated restarts can interrupt CSI, manager, engine image, or instance-manager responsibilities.',
        affected: compactEvidence([
          affectedMetric('Pods with restarts', longhorn.pods?.withRestarts),
          affectedMetric('Total Longhorn pods', longhorn.pods?.total),
        ]),
        recommendedChecks: [
          'Review restart counts alongside manager panic and endpoint findings.',
          'Open the pod YAML and related container logs for the highest restart counts first.',
        ],
        evidence: mergeEvidence([podRestartFinding]),
        relatedFindingIds: findingIds([podRestartFinding]),
      }),
    );
  }

  if (monitoringFindings.length) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-monitoring-alerts',
        severity: highestSeverity(monitoringFindings),
        title: 'Monitoring alerts were firing',
        description:
          'The bundle includes firing Prometheus alerts with actionable severity labels.',
        impact:
          'Alertmanager already detected symptoms that should be compared with the Longhorn resource state.',
        affected: [affectedMetric('Firing alerts', monitoringFindings.length)],
        recommendedChecks: [
          'Compare alert timestamps with Longhorn manager and Kubernetes event timelines.',
          'Use the alert runbook URL when one is present in prometheus-alerts.json.',
        ],
        evidence: mergeEvidence(monitoringFindings),
        relatedFindingIds: findingIds(monitoringFindings),
      }),
    );
  }

  if (collectionFinding) {
    groups.push(
      createFindingGroup({
        id: 'longhorn-collection-gaps',
        severity: collectionFinding.severity,
        title: 'Support bundle has collection gaps',
        description:
          'The support bundle generator could not collect every requested API resource or pod log.',
        impact:
          'The report can still be useful, but absence of a log or resource should not be treated as proof that it was healthy.',
        affected: [affectedMetric('Collection errors', collectionFinding.count)],
        recommendedChecks: [
          'Review bundleGenerationError.log before concluding a resource was unavailable.',
          'If a missing log is central to the case, collect a fresh bundle or query that pod directly.',
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

  if (!file || !file.content.trim()) {
    return null;
  }

  const lines = file.content.split(/\r?\n/).filter(Boolean);
  const issueLines = lines.filter((line) => /\b(failed|bug|error)\b/i.test(line));

  if (!issueLines.length) {
    return null;
  }

  return createFinding({
    id: 'longhorn-bundle-generation-errors',
    severity: 'warning',
    category: 'Collection',
    title: 'Support bundle collection had errors',
    description:
      'The bundle generator reported resources or pod logs it could not collect. The analysis may be missing those details.',
    evidence: issueLines.slice(0, 5),
    count: issueLines.length,
    path: file.reportPath,
  });
}

async function analyzePrometheusAlerts(context) {
  const file = await readReportFile(context, 'prometheus-alerts.json');

  if (!file) {
    return [];
  }

  let alerts = [];

  try {
    const parsed = JSON.parse(file.content);
    alerts = Array.isArray(parsed) ? parsed : [];
  } catch {
    return [
      createFinding({
        id: 'longhorn-prometheus-alerts-invalid-json',
        severity: 'warning',
        category: 'Monitoring',
        title: 'Prometheus alerts file could not be parsed',
        description: 'The support bundle included prometheus-alerts.json, but it is not valid JSON.',
        path: file.reportPath,
      }),
    ];
  }

  return alerts
    .filter((alert) => {
      const severity = String(alert.Labels?.severity ?? '').toLowerCase();
      const state = String(alert.State ?? '').toLowerCase();
      return state === 'firing' && severity && severity !== 'none';
    })
    .slice(0, MAX_FINDINGS_PER_RULE)
    .map((alert) => {
      const alertName = alert.Labels?.alertname ?? 'Prometheus alert';
      const severity = mapAlertSeverity(alert.Labels?.severity);
      const summary = alert.Annotations?.summary ?? alert.Annotations?.description ?? 'Alert is firing.';

      return createFinding({
        id: `longhorn-prometheus-${slugify(alertName)}`,
        severity,
        category: 'Monitoring',
        title: `${alertName} is firing`,
        description: summary,
        evidence: [`State: ${alert.State}`, `Severity: ${alert.Labels?.severity ?? 'unknown'}`],
        path: file.reportPath,
      });
    });
}

async function analyzeVolumes(context) {
  const file = await readReportFile(
    context,
    `${LONGHORN_RESOURCE_ROOT}/longhorn.io/v1beta2/volumes.yaml`,
  );
  const inventory = { total: 0, unhealthy: 0 };

  if (!file) {
    return { inventory, findings: [] };
  }

  const findings = [];
  const volumes = splitKubernetesItems(file.content);
  inventory.total = volumes.length;

  for (const volume of volumes) {
    const name = readMetadataName(volume) ?? 'unknown volume';
    const status = topLevelSection(volume, 'status');
    const robustness = readScalar(status, 'robustness');
    const state = readScalar(status, 'state');
    const currentNodeID = readScalar(status, 'currentNodeID');

    if (robustness && robustness !== 'healthy') {
      inventory.unhealthy += 1;
      findings.push(
        createFinding({
          id: `longhorn-volume-${slugify(name)}-${slugify(robustness)}`,
          severity: robustness === 'faulted' ? 'critical' : 'warning',
          category: 'Longhorn Volume',
          title: `Volume ${name} is ${robustness}`,
          description: 'Longhorn reports a volume robustness value other than healthy.',
          evidence: compactEvidence([
            `Robustness: ${robustness}`,
            state ? `State: ${state}` : null,
            currentNodeID ? `Current node: ${currentNodeID}` : null,
          ]),
          path: file.reportPath,
        }),
      );
    }

    for (const condition of extractConditions(status)) {
      if (
        condition.status === 'True' &&
        VOLUME_TRUE_PROBLEM_CONDITIONS.has(condition.type)
      ) {
        findings.push(
          createFinding({
            id: `longhorn-volume-${slugify(name)}-${slugify(condition.type)}`,
            severity: 'warning',
            category: 'Longhorn Volume',
            title: `Volume ${name} has ${condition.type}`,
            description: 'A Longhorn volume condition that usually indicates pending work is active.',
            evidence: conditionEvidence(condition),
            path: file.reportPath,
          }),
        );
      }
    }
  }

  return { inventory, findings: findings.slice(0, MAX_FINDINGS_PER_RULE) };
}

async function analyzeReplicas(context) {
  const file = await readReportFile(
    context,
    `${LONGHORN_RESOURCE_ROOT}/longhorn.io/v1beta2/replicas.yaml`,
  );
  const inventory = { total: 0, notRunning: 0 };

  if (!file) {
    return { inventory, findings: [] };
  }

  const findings = [];
  const replicas = splitKubernetesItems(file.content);
  inventory.total = replicas.length;

  for (const replica of replicas) {
    const name = readMetadataName(replica) ?? 'unknown replica';
    const status = topLevelSection(replica, 'status');
    const currentState = readScalar(status, 'currentState');

    if (currentState && currentState !== 'running') {
      inventory.notRunning += 1;
      findings.push(
        createFinding({
          id: `longhorn-replica-${slugify(name)}-${slugify(currentState)}`,
          severity: 'warning',
          category: 'Longhorn Replica',
          title: `Replica ${name} is ${currentState}`,
          description: 'Longhorn reports a replica state other than running.',
          evidence: [`Current state: ${currentState}`],
          path: file.reportPath,
        }),
      );
    }

    for (const condition of extractConditions(status)) {
      if (
        condition.status === 'True' &&
        REPLICA_TRUE_PROBLEM_CONDITIONS.has(condition.type)
      ) {
        findings.push(
          createFinding({
            id: `longhorn-replica-${slugify(name)}-${slugify(condition.type)}`,
            severity: condition.type === 'FilesystemReadOnly' ? 'critical' : 'warning',
            category: 'Longhorn Replica',
            title: `Replica ${name} has ${condition.type}`,
            description: 'A Longhorn replica problem condition is active.',
            evidence: conditionEvidence(condition),
            path: file.reportPath,
          }),
        );
      }
    }
  }

  return { inventory, findings: findings.slice(0, MAX_FINDINGS_PER_RULE) };
}

async function analyzeLonghornNodes(context) {
  const file = await readReportFile(
    context,
    `${LONGHORN_RESOURCE_ROOT}/longhorn.io/v1beta2/nodes.yaml`,
  );
  const inventory = { total: 0, problematic: 0 };

  if (!file) {
    return { inventory, findings: [] };
  }

  const findings = [];
  const nodes = splitKubernetesItems(file.content);
  inventory.total = nodes.length;

  for (const node of nodes) {
    const name = readMetadataName(node) ?? 'unknown node';
    const status = topLevelSection(node, 'status');
    let nodeHasProblem = false;

    for (const condition of extractConditions(status)) {
      const expectedTrueProblem =
        NODE_TRUE_CONDITIONS.has(condition.type) && condition.status !== 'True';
      const multipathProblem =
        condition.type === 'Multipathd' &&
        condition.status !== 'True' &&
        hasUsefulConditionDetail(condition);

      if (!expectedTrueProblem && !multipathProblem) {
        continue;
      }

      nodeHasProblem = true;
      findings.push(
        createFinding({
          id: `longhorn-node-${slugify(name)}-${slugify(condition.type)}`,
          severity: condition.type === 'Ready' ? 'critical' : 'warning',
          category: 'Longhorn Node',
          title: `Node ${name} has ${condition.type} issue`,
          description: 'A Longhorn node readiness or prerequisite condition is not satisfied.',
          evidence: conditionEvidence(condition),
          path: file.reportPath,
        }),
      );
    }

    if (nodeHasProblem) {
      inventory.problematic += 1;
    }
  }

  return { inventory, findings: findings.slice(0, MAX_FINDINGS_PER_RULE) };
}

async function analyzeLonghornPods(context) {
  const file = await readReportFile(context, `${LONGHORN_RESOURCE_ROOT}/v1/pods.yaml`);
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
          id: `longhorn-pod-${slugify(name)}-${slugify(phase)}`,
          severity: 'warning',
          category: 'Longhorn Pod',
          title: `Pod ${name} is ${phase}`,
          description: 'A pod in longhorn-system is not currently running.',
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
        id: 'longhorn-pods-with-container-restarts',
        severity: restartEvidence.some((line) => /=[5-9]\d*|=\d{2,}/.test(line))
          ? 'warning'
          : 'info',
        category: 'Longhorn Pod',
        title: 'Longhorn pods have container restarts',
        description: 'One or more Longhorn pods report non-zero container restart counts.',
        evidence: restartEvidence.slice(0, 6),
        count: restartEvidence.length,
        path: file.reportPath,
      }),
    );
  }

  return { inventory, findings: findings.slice(0, MAX_FINDINGS_PER_RULE) };
}

async function analyzeLonghornEvents(context) {
  const file = await readReportFile(context, `${LONGHORN_RESOURCE_ROOT}/v1/events.yaml`);
  const inventory = { total: 0, warnings: 0 };

  if (!file) {
    return { inventory, findings: [] };
  }

  const events = splitKubernetesItems(file.content);
  inventory.total = events.length;

  const warningEvents = events
    .filter((event) => readTopLevelScalar(event, 'type') === 'Warning')
    .map((event) => ({
      reason: readTopLevelScalar(event, 'reason') ?? 'Warning',
      message: readTopLevelScalar(event, 'message') ?? 'Warning event',
    }));

  inventory.warnings = warningEvents.length;

  if (!warningEvents.length) {
    return { inventory, findings: [] };
  }

  return {
    inventory,
    findings: [
      createFinding({
        id: 'longhorn-warning-events',
        severity: 'warning',
        category: 'Kubernetes Events',
        title: 'Warning events found in longhorn-system',
        description: 'Kubernetes recorded warning events in the Longhorn namespace.',
        evidence: warningEvents
          .slice(0, 6)
          .map((event) => `${event.reason}: ${event.message}`),
        count: warningEvents.length,
        path: file.reportPath,
      }),
    ],
  };
}

async function analyzeLonghornLogs(context) {
  const logEntries = context.index
    .filter(
      (entry) =>
        entry.type === 'file' &&
        normalizeReportPath(entry.path).includes('/logs/longhorn-system/') &&
        /\.(log|log\.\d+|\d+)$/.test(entry.path),
    )
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
    path: null,
  }]));

  for (const entry of logEntries) {
    const sample = await readTextSample(context.extractDir, entry.path);

    if (!sample) {
      continue;
    }

    const lines = sample.content.split(/\r?\n/);

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];

      for (const match of matchesByPattern.values()) {
        if (!match.pattern.test.test(line)) {
          continue;
        }

        match.count += 1;
        inventory.matchedLines += 1;
        match.path ??= entry.path;

        if (match.evidence.length < 4) {
          match.evidence.push(`${shortenReportPath(entry.path)}:${index + 1} ${truncate(line, 220)}`);
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
        count: match.count,
        path: match.path,
      }),
    );

  return { inventory, findings };
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

async function readTextSample(rootDir, reportPath) {
  const filePath = safeResolve(rootDir, reportPath);
  const stats = await fs.stat(filePath);
  const handle = await fs.open(filePath, 'r');

  try {
    if (stats.size <= LOG_SAMPLE_BYTES * 2) {
      return {
        content: await fs.readFile(filePath, 'utf8'),
      };
    }

    const head = Buffer.alloc(LOG_SAMPLE_BYTES);
    const tail = Buffer.alloc(LOG_SAMPLE_BYTES);
    await handle.read(head, 0, LOG_SAMPLE_BYTES, 0);
    await handle.read(tail, 0, LOG_SAMPLE_BYTES, stats.size - LOG_SAMPLE_BYTES);

    return {
      content: `${head.toString('utf8')}\n${tail.toString('utf8')}`,
    };
  } finally {
    await handle.close();
  }
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
      inStatuses = true;
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

function createFinding({ id, severity, category, title, description, evidence = [], count = null, path = null }) {
  return {
    id,
    severity,
    category,
    title,
    description,
    evidence,
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

function hasUsefulConditionDetail(condition) {
  return Boolean(
    condition.reason ||
      (condition.message && condition.message !== 'null') ||
      condition.type === 'Multipathd',
  );
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

  return [...new Set(evidence)].slice(0, 8);
}

function affectedMetric(label, value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  return `${label}: ${value}`;
}

function mapAlertSeverity(severity) {
  const normalized = String(severity ?? '').toLowerCase();

  if (normalized === 'critical') {
    return 'critical';
  }

  if (normalized === 'warning' || normalized === 'warn') {
    return 'warning';
  }

  return 'info';
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
  const marker = '/logs/longhorn-system/';
  const index = normalized.indexOf(marker);

  return index === -1 ? normalized : normalized.slice(index + 1);
}

function logPriority(reportPath) {
  const normalized = normalizeReportPath(reportPath);

  if (normalized.includes('/longhorn-manager-')) {
    return 0;
  }

  if (normalized.includes('/instance-manager-')) {
    return 1;
  }

  if (normalized.includes('/engine-image-')) {
    return 2;
  }

  if (normalized.includes('/csi-')) {
    return 3;
  }

  return 4;
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
