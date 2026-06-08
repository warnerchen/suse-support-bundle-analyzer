import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAdvisorContext } from '../src/ai/aiAdvisorService.js';
import { GeminiAdvisorProvider } from '../src/ai/geminiAdvisorProvider.js';

test('Gemini advisor provider sends generateContent requests and normalizes bilingual advice', async () => {
  let capturedUrl = '';
  let capturedHeaders = {};
  let requestBody = {};
  const provider = new GeminiAdvisorProvider({
    apiKey: 'test-key',
    model: 'gemini-2.0-flash',
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedHeaders = options.headers;
      requestBody = JSON.parse(options.body);

      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      summary: {
                        en: 'Replica scheduling is likely constrained by disk capacity.',
                        zhCN: '副本调度很可能受到磁盘容量限制。',
                      },
                      kbCoverage: {
                        status: 'strong',
                        en: 'A related KB article matches the scheduler error.',
                        zhCN: '相关 KB 与调度错误高度匹配。',
                      },
                      suggestions: [
                        {
                          priority: 'high',
                          confidence: 'high',
                          title: {
                            en: 'Check usable Longhorn disk space',
                            zhCN: '检查 Longhorn 可用磁盘空间',
                          },
                          rationale: {
                            en: 'Evidence includes insufficient storage precheck failures.',
                            zhCN: '证据包含存储不足的预检查失败。',
                          },
                          actions: {
                            en: ['Review node disk free and reserved space.'],
                            zhCN: ['检查节点磁盘剩余空间和预留空间。'],
                          },
                          evidence: ['insufficient storage'],
                          relatedKbTitles: ['Troubleshooting: volume pvc-xxx not scheduled'],
                        },
                      ],
                      questions: {
                        en: ['Was disk pressure present during the incident?'],
                        zhCN: ['故障发生时是否存在磁盘压力？'],
                      },
                      limitations: {
                        en: ['Advice is based on extracted support bundle evidence only.'],
                        zhCN: ['建议仅基于 support bundle 中提取到的证据。'],
                      },
                    }),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  });

  const advice = await provider.generateAdvice({
    productType: 'longhorn',
    findingGroups: [{ title: 'Replica scheduling failure' }],
  });

  assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent');
  assert.equal(capturedHeaders['x-goog-api-key'], 'test-key');
  assert.match(requestBody.systemInstruction.parts[0].text, /SUSE technical support advisor/);
  assert.match(requestBody.contents[0].parts[0].text, /Replica scheduling failure/);
  assert.equal(advice.provider, 'gemini');
  assert.equal(advice.model, 'models/gemini-2.0-flash');
  assert.equal(advice.status, 'generated');
  assert.equal(advice.kbCoverage.status, 'strong');
  assert.equal(advice.suggestions[0].title.zhCN, '检查 Longhorn 可用磁盘空间');
  assert.equal(advice.suggestions[0].actions.en[0], 'Review node disk free and reserved space.');
});

test('Gemini advisor provider reports API errors clearly', async () => {
  const provider = new GeminiAdvisorProvider({
    apiKey: 'test-key',
    model: 'gemini-2.0-flash',
    fetchImpl: async () =>
      new Response(
        JSON.stringify({
          error: {
            message: 'model not found',
          },
        }),
        { status: 404 },
      ),
  });

  await assert.rejects(
    () => provider.generateAdvice({ productType: 'longhorn' }),
    /Gemini advisor request failed with HTTP 404: model not found/,
  );
});

test('buildAdvisorContext keeps report evidence compact for AI input', () => {
  const report = {
    productType: 'harvester',
    generatedAt: '2026-06-08T00:00:00.000Z',
    archive: {
      filename: 'supportbundle.zip',
      archiveType: 'zip',
      fileSize: 123,
      sha256: 'abc',
    },
    analyzer: {
      id: 'harvester',
      label: 'Harvester',
    },
    inventory: {
      metadata: {
        kubernetesversion: 'v1.31.7+rke2r1',
      },
      harvester: {
        version: {
          version: 'v1.5.1',
        },
        virtualMachines: {
          total: 3,
          notReady: 1,
        },
      },
    },
    findingGroups: [
      {
        id: 'harvester-vm-workload-health',
        severity: 'warning',
        title: 'VM workload health needs attention',
        description: 'VMs are not ready',
        evidence: ['default/vm-a is not ready'],
        relatedKb: [{ title: 'Troubleshooting VM scheduling', score: 0.91, excerpt: 'Node selector issues' }],
        relatedFindingIds: ['harvester-vms-not-ready'],
      },
    ],
    findings: [
      {
        id: 'harvester-vms-not-ready',
        severity: 'warning',
        category: 'Harvester VM',
        title: 'VMs are not ready',
        evidence: ['default/vm-a is not ready'],
      },
    ],
    correlations: {
      harvesterWorkloads: [
        {
          kind: 'VirtualMachine',
          namespace: 'default',
          name: 'vm-a',
          severity: 'warning',
          signalCount: 2,
          evidence: ['VMI pending'],
        },
      ],
    },
  };

  const context = buildAdvisorContext(report);

  assert.equal(context.productType, 'harvester');
  assert.equal(context.environment.productVersion.version, 'v1.5.1');
  assert.equal(context.findingGroups[0].relatedKb[0].score, 0.91);
  assert.equal(context.ungroupedFindings.length, 0);
  assert.equal(context.affectedObjects[0].name, 'vm-a');
});
