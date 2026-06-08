import test from 'node:test';
import assert from 'node:assert/strict';
import { AnalysisService } from '../src/services/analysisService.js';

test('getReport lazily generates and stores AI advice for existing completed reports', async () => {
  const baseReport = {
    jobId: 'job-1',
    bundleId: 'bundle-1',
    productType: 'longhorn',
    findingGroups: [{ id: 'group-1', title: 'Replica scheduling issue' }],
    findings: [],
  };
  let savedReport = null;
  let adviseCalls = 0;
  const service = new AnalysisService({
    analyzer: {
      async enrichExistingReport(report) {
        return {
          ...report,
          analyzer: { id: 'longhorn' },
        };
      },
    },
    bundleRepository: {},
    storage: {},
    jobRepository: {
      async findById(id) {
        return { id, status: 'completed' };
      },
    },
    reportRepository: {
      async findByJobId() {
        return baseReport;
      },
      async save(jobId, report) {
        savedReport = { jobId, report };
      },
    },
    kbService: {
      async enrichReport(report) {
        return {
          ...report,
          kbSummary: { enabled: true },
        };
      },
    },
    aiAdvisorService: {
      descriptor: {
        provider: 'gemini',
        model: 'models/gemini-2.0-flash',
      },
      async adviseReport(report) {
        adviseCalls += 1;
        return {
          ...report,
          aiAdvisor: {
            status: 'generated',
            provider: 'gemini',
            model: 'models/gemini-2.0-flash',
            suggestions: [],
          },
        };
      },
    },
  });

  const report = await service.getReport('job-1');

  assert.equal(adviseCalls, 1);
  assert.equal(report.aiAdvisor.status, 'generated');
  assert.equal(savedReport.jobId, 'job-1');
  assert.equal(savedReport.report.aiAdvisor.model, 'models/gemini-2.0-flash');
});

test('getReport reuses existing generated AI advice for the same provider model', async () => {
  let adviseCalls = 0;
  const service = new AnalysisService({
    analyzer: {},
    bundleRepository: {},
    storage: {},
    jobRepository: {
      async findById(id) {
        return { id, status: 'completed' };
      },
    },
    reportRepository: {
      async findByJobId() {
        return {
          jobId: 'job-1',
          bundleId: 'bundle-1',
          productType: 'harvester',
          aiAdvisor: {
            status: 'generated',
            provider: 'gemini',
            model: 'models/gemini-2.0-flash',
            suggestions: [],
          },
        };
      },
      async save() {
        throw new Error('save should not be called');
      },
    },
    aiAdvisorService: {
      descriptor: {
        provider: 'gemini',
        model: 'models/gemini-2.0-flash',
      },
      async adviseReport(report) {
        adviseCalls += 1;
        return report;
      },
    },
  });

  const report = await service.getReport('job-1');

  assert.equal(adviseCalls, 0);
  assert.equal(report.aiAdvisor.status, 'generated');
});
