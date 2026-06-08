const MAX_GROUPS = 8;
const MAX_FINDINGS = 10;
const MAX_WORKLOADS = 8;
const MAX_TEXT_LENGTH = 900;
const MAX_CONTEXT_JSON_LENGTH = 30000;

export class AiAdvisorService {
  constructor({ provider, logger = null }) {
    this.provider = provider;
    this.logger = logger;
  }

  get descriptor() {
    return this.provider?.descriptor ?? {
      provider: 'off',
    };
  }

  async adviseReport(report) {
    if (!this.provider) {
      return report;
    }

    const startedAt = Date.now();
    const context = buildAdvisorContext(report);
    const aiAdvisor = await this.provider.generateAdvice(context);

    this.logger?.info('ai_advisor.completed', {
      jobId: report.jobId,
      bundleId: report.bundleId,
      productType: report.productType,
      provider: aiAdvisor.provider,
      model: aiAdvisor.model,
      suggestionCount: aiAdvisor.suggestions?.length ?? 0,
      kbCoverage: aiAdvisor.kbCoverage?.status,
      durationMs: Date.now() - startedAt,
    });

    return {
      ...report,
      aiAdvisor,
    };
  }
}

export function buildAdvisorContext(report) {
  const findingGroups = (report.findingGroups ?? [])
    .slice(0, MAX_GROUPS)
    .map((group) => ({
      id: group.id,
      severity: group.severity,
      title: compactText(group.title),
      description: compactText(group.description),
      impact: compactText(group.impact),
      affected: compactTextArray(group.affected, 8),
      recommendedChecks: compactTextArray(group.recommendedChecks, 8),
      evidence: compactTextArray(group.evidence, 8),
      relatedFindingIds: compactTextArray(group.relatedFindingIds, 12),
      relatedKb: (group.relatedKb ?? []).slice(0, 3).map((article) => ({
        title: compactText(article.title),
        sourceUri: article.sourceUri,
        score: roundScore(article.score),
        excerpt: compactText(article.excerpt),
      })),
    }));
  const groupedFindingIds = new Set(findingGroups.flatMap((group) => group.relatedFindingIds ?? []));
  const findings = (report.findings ?? [])
    .filter((finding) => !groupedFindingIds.has(finding.id))
    .slice(0, MAX_FINDINGS)
    .map(compactFinding);
  const keyErrors = [
    ...findingGroups.flatMap((group) => group.evidence ?? []),
    ...findings.flatMap((finding) => finding.evidence ?? []),
  ].slice(0, 16);
  const context = {
    productType: report.productType,
    generatedAt: report.generatedAt,
    analyzer: report.analyzer,
    archive: {
      filename: report.archive?.filename,
      archiveType: report.archive?.archiveType,
      fileSize: report.archive?.fileSize,
      sha256: report.archive?.sha256,
    },
    environment: buildEnvironmentSummary(report.inventory),
    findingSummary: report.findingSummary,
    groupSummary: report.groupSummary,
    kbSummary: {
      enabled: report.kbSummary?.enabled,
      documentCount: report.kbSummary?.documentCount,
      chunkCount: report.kbSummary?.chunkCount,
      embedding: report.kbSummary?.embedding,
    },
    findingGroups,
    ungroupedFindings: findings,
    affectedObjects: compactAffectedObjects(report.correlations),
    keyErrors,
    notes: compactTextArray(report.notes, 6),
  };

  return clampContext(context);
}

function compactFinding(finding) {
  return {
    id: finding.id,
    severity: finding.severity,
    category: finding.category,
    title: compactText(finding.title),
    description: compactText(finding.description),
    count: finding.count,
    evidence: compactTextArray(finding.evidence, 5),
    path: finding.path,
  };
}

function buildEnvironmentSummary(inventory = {}) {
  const metadata = inventory.metadata ?? {};
  const productInventory = inventory.longhorn ?? inventory.harvester ?? {};

  return {
    metadata: compactObject({
      kubernetesVersion: metadata.kubernetesversion ?? metadata.kubernetesVersion,
      createdAt: metadata.creationtimestamp ?? metadata.createdAt,
      issue: metadata.issuedescription ?? metadata.issueDescription,
    }),
    productVersion: productInventory.version ?? null,
    inventory: compactObject(productInventory),
  };
}

function compactAffectedObjects(correlations = {}) {
  return (correlations.harvesterWorkloads ?? []).slice(0, MAX_WORKLOADS).map((workload) => ({
    kind: workload.kind,
    namespace: workload.namespace,
    name: workload.name,
    severity: workload.severity,
    status: workload.status,
    vmiPhase: workload.vmiPhase,
    nodeName: workload.nodeName,
    desiredNodeNames: compactTextArray(workload.desiredNodeNames, 4),
    signalCount: workload.signalCount,
    relatedFindingIds: compactTextArray(workload.relatedFindingIds, 8),
    evidence: compactTextArray(workload.evidence, 5),
  }));
}

function compactObject(value, depth = 0) {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'string' ? compactText(value) : value;
  }

  if (Array.isArray(value)) {
    return value.slice(0, 8).map((item) => compactObject(item, depth + 1));
  }

  if (depth >= 3) {
    return '[nested object]';
  }

  return Object.fromEntries(
    Object.entries(value)
      .filter(([, item]) => item !== null && item !== undefined && item !== '')
      .slice(0, 20)
      .map(([key, item]) => [key, compactObject(item, depth + 1)]),
  );
}

function compactTextArray(values = [], limit) {
  return (Array.isArray(values) ? values : [values])
    .map((value) => compactText(value))
    .filter(Boolean)
    .slice(0, limit);
}

function compactText(value, maxLength = MAX_TEXT_LENGTH) {
  const normalized = String(value ?? '').replace(/\s+/g, ' ').trim();

  if (!normalized) {
    return '';
  }

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 3)}...` : normalized;
}

function roundScore(score) {
  return Number.isFinite(score) ? Math.round(score * 1000) / 1000 : null;
}

function clampContext(context) {
  const json = JSON.stringify(context);

  if (json.length <= MAX_CONTEXT_JSON_LENGTH) {
    return context;
  }

  return {
    ...context,
    findingGroups: context.findingGroups.slice(0, 4).map((group) => ({
      ...group,
      evidence: group.evidence.slice(0, 4),
      relatedKb: group.relatedKb.slice(0, 2),
    })),
    ungroupedFindings: context.ungroupedFindings.slice(0, 4),
    affectedObjects: context.affectedObjects.slice(0, 4),
    keyErrors: context.keyErrors.slice(0, 8),
    truncated: true,
  };
}
