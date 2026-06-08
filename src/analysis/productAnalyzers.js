import {
  analyzeHarvesterSupportBundle,
  buildHarvesterWorkloadCorrelations,
  detectHarvesterVersion,
} from './harvesterAnalyzer.js';
import { analyzeLonghornSupportBundle, detectLonghornVersion } from './longhornAnalyzer.js';

export const PRODUCT_ANALYZERS = [
  {
    id: 'longhorn',
    label: 'Longhorn',
    version: 'rules-v1',
    capabilities: ['inventory', 'logs', 'findings', 'finding-groups', 'version-detection', 'kb-query-context'],
    analyze: analyzeLonghornSupportBundle,
    async enrichExistingReport(report, { extractDir, index }) {
      if (report.inventory?.longhorn?.version) {
        return report;
      }

      const version = await detectLonghornVersion({ extractDir, index });

      if (!version) {
        return report;
      }

      return {
        ...report,
        inventory: {
          ...(report.inventory ?? {}),
          longhorn: {
            ...(report.inventory?.longhorn ?? {}),
            version,
          },
        },
      };
    },
  },
  {
    id: 'harvester',
    label: 'Harvester',
    version: 'rules-v1',
    capabilities: [
      'inventory',
      'logs',
      'findings',
      'finding-groups',
      'version-detection',
      'workload-correlations',
      'kb-query-context',
    ],
    analyze: analyzeHarvesterSupportBundle,
    async enrichExistingReport(report, { extractDir, index }) {
      let nextReport = report;

      if (!nextReport.inventory?.harvester?.version) {
        const version = await detectHarvesterVersion({ extractDir, index });

        if (version) {
          nextReport = {
            ...nextReport,
            inventory: {
              ...(nextReport.inventory ?? {}),
              harvester: {
                ...(nextReport.inventory?.harvester ?? {}),
                version,
              },
            },
          };
        }
      }

      if (!nextReport.correlations?.harvesterWorkloads) {
        nextReport = {
          ...nextReport,
          correlations: await buildHarvesterWorkloadCorrelations(
            { extractDir, index },
            { findings: nextReport.findings ?? [] },
          ),
        };
      }

      return nextReport;
    },
  },
];

const PRODUCT_ANALYZER_BY_ID = new Map(PRODUCT_ANALYZERS.map((analyzer) => [analyzer.id, analyzer]));

export function getProductAnalyzer(productType) {
  return PRODUCT_ANALYZER_BY_ID.get(String(productType ?? '').trim().toLowerCase()) ?? null;
}

export function productAnalyzerDescriptor(analyzer) {
  if (!analyzer) {
    return {
      id: 'unsupported',
      label: 'Unsupported',
      version: 'none',
      capabilities: [],
    };
  }

  return {
    id: analyzer.id,
    label: analyzer.label,
    version: analyzer.version,
    capabilities: [...(analyzer.capabilities ?? [])],
  };
}

export function emptyProductAnalysis() {
  return {
    inventory: {},
    groupSummary: {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    },
    findingGroups: [],
    findingSummary: {
      total: 0,
      critical: 0,
      warning: 0,
      info: 0,
    },
    findings: [],
  };
}
