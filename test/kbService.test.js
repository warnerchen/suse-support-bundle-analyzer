import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KbService } from '../src/kb/kbService.js';
import { KbStore } from '../src/kb/kbStore.js';
import { extractDocumentLinks, extractKbLinks, normalizeKbDocument } from '../src/kb/kbText.js';
import { LocalEmbeddingProvider } from '../src/kb/localEmbeddingProvider.js';

test('extracts Longhorn KB article links from an index page', () => {
  const links = extractKbLinks(
    [
      '<a href="/kb/troubleshooting-volume-pvc-xxx-not-scheduled/">Scheduled</a>',
      '<a href="https://longhorn.io/kb/manual-recovery-of-nodes-with-insufficient-space/">Recovery</a>',
      '<a href="/docs/1.11.2/">Docs</a>',
      '<a href="/kb/">Index</a>',
    ].join('\n'),
    'https://longhorn.io/kb/',
  );

  assert.deepEqual(links, [
    'https://longhorn.io/kb/manual-recovery-of-nodes-with-insufficient-space/',
    'https://longhorn.io/kb/troubleshooting-volume-pvc-xxx-not-scheduled/',
  ]);
});

test('extracts same-path document links for non-Longhorn documentation indexes', () => {
  const links = extractDocumentLinks(
    [
      '<a href="/docs/troubleshooting/storage/">Storage</a>',
      '<a href="/docs/troubleshooting/network/">Network</a>',
      '<a href="/docs/install/">Install</a>',
      '<a href="/assets/app.js">Script</a>',
      '<a href="https://example.com/docs/troubleshooting/storage/">External</a>',
    ].join('\n'),
    'https://harvester.example/docs/troubleshooting/',
  );

  assert.deepEqual(links, [
    'https://harvester.example/docs/troubleshooting/network/',
    'https://harvester.example/docs/troubleshooting/storage/',
  ]);
});

test('imports KB URLs and searches the local vector index', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-store-'));

  try {
    const service = new KbService({
      store: new KbStore({
        storageDir,
        embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
      }),
      fetchImpl: fixtureFetch({
        'https://longhorn.io/kb/': `
          <html><body>
            <table>
              <tr><td><a href="/kb/troubleshooting-volume-pvc-xxx-not-scheduled/">Troubleshooting volume not scheduled</a></td></tr>
              <tr><td><a href="/kb/troubleshooting-manager-stuck-in-crash-loop-state-due-to-inaccessible-webhook/">Manager CrashLoopBackOff</a></td></tr>
            </table>
          </body></html>
        `,
        'https://longhorn.io/kb/troubleshooting-volume-pvc-xxx-not-scheduled/': longhornArticleHtml({
          title: 'Troubleshooting: `volume pvc-xxx not scheduled`',
          body: [
            '<h2>Symptoms</h2>',
            '<p>The Pod cannot start because the Longhorn volume is not scheduled.</p>',
            '<h2>Details</h2>',
            '<p>This is caused by Longhorn not finding enough space on different nodes to store replicas.</p>',
            '<p>Check replica count, node level soft anti-affinity, disk scheduling, and available storage.</p>',
          ].join('\n'),
        }),
        'https://longhorn.io/kb/troubleshooting-manager-stuck-in-crash-loop-state-due-to-inaccessible-webhook/':
          longhornArticleHtml({
            title: 'Troubleshooting: Longhorn Manager Stuck in CrashLoopBackOff State Due to Inaccessible Webhook',
            body: [
              '<h2>Symptoms</h2>',
              '<p>Longhorn manager can crash when webhook endpoints are inaccessible.</p>',
              '<h2>Details</h2>',
              '<p>Inspect webhook readiness, service endpoints, and manager logs.</p>',
            ].join('\n'),
          }),
      }),
      importLimit: 10,
    });

    await service.ensureReady();
    const result = await service.importFromUrls(['https://longhorn.io/kb/']);

    assert.equal(result.documentsImported, 2);
    assert.ok(result.chunksIndexed >= 2);

    const matches = await service.search('replica scheduling insufficient storage not scheduled', {
      productType: 'longhorn',
      limit: 2,
    });

    assert.equal(matches[0].title, 'Troubleshooting: `volume pvc-xxx not scheduled`');
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('previews KB URLs without mutating the local vector index', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-preview-store-'));
  const sourceUrl = 'https://longhorn.io/kb/volume-recovery/';

  try {
    const service = new KbService({
      store: new KbStore({
        storageDir,
        embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
      }),
      fetchImpl: fixtureFetch({
        [sourceUrl]: longhornArticleHtml({
          title: 'Manual Recovery of a Longhorn Volume',
          body: [
            '<h2>Symptoms</h2>',
            '<p>A Longhorn volume can become degraded after a node outage or replica rebuild interruption.</p>',
            '<h2>Recovery</h2>',
            '<p>Collect manager logs, inspect replica status, confirm engine image health, and verify node disk availability.</p>',
            '<p>After the failed replica is identified, create a replacement replica and wait for rebuilding to complete.</p>',
            '<p>Confirm workload attachment, data path readiness, and recurring backup status before closing the incident.</p>',
          ].join('\n'),
        }),
      }),
    });

    await service.ensureReady();
    const preview = await service.previewFromUrls([sourceUrl], {
      expandLinks: false,
      productType: 'longhorn',
    });
    const stats = await service.getStatus();

    assert.equal(preview.importableCount, 1);
    assert.equal(preview.documents[0].sourceUri, sourceUrl);
    assert.equal(preview.documents[0].chunkCount, 1);
    assert.equal(stats.documentCount, 0);
    assert.equal(stats.chunkCount, 0);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('imports Markdown files into the local vector index', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-md-store-'));

  try {
    const service = new KbService({
      store: new KbStore({
        storageDir,
        embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
      }),
    });
    await service.ensureReady();

    const result = await service.importFromFiles(
      [
        markdownFile(
          'harvester-storage.md',
          [
            '# Harvester Storage Network Troubleshooting',
            '',
            'When Harvester storage network routes are missing, Longhorn volume attachment can fail.',
            'Check VLAN configuration, node network status, and storage network reachability.',
          ].join('\n'),
        ),
        markdownFile(
          'harvester-upgrade.markdown',
          [
            '# Harvester Upgrade Runbook',
            '',
            'Before upgrade, confirm images are downloaded and cluster operators are healthy.',
          ].join('\n'),
        ),
      ],
      { productType: 'harvester' },
    );

    assert.equal(result.documentsImported, 2);
    assert.ok(result.chunksIndexed >= 2);

    const matches = await service.search('harvester storage network routes attachment fail', {
      productType: 'harvester',
      limit: 2,
    });

    assert.equal(matches[0].title, 'Harvester Storage Network Troubleshooting');
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('skips remote pages without readable KB article content', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-shell-store-'));
  const sourceUrl = 'https://support.scc.suse.com/s/kb/Bypassing-a-Deleted-Node-During-Harvester-Upgrade?language=en_US';

  try {
    const service = new KbService({
      store: new KbStore({
        storageDir,
        embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
      }),
      fetchImpl: fixtureFetch({
        [sourceUrl]: `
          <html>
            <head><title>SUSE Customer Portal</title></head>
            <body>
              <div>Loading</div>
              <div>Sorry to interrupt</div>
              <div>CSS Error</div>
              <a href="?">Refresh</a>
            </body>
          </html>
        `,
      }),
    });

    await service.ensureReady();
    const preview = await service.previewFromUrls([sourceUrl], {
      expandLinks: false,
      productType: 'harvester',
    });
    const result = await service.importFromUrls([sourceUrl], {
      expandLinks: false,
      productType: 'harvester',
    });
    const stats = await service.getStatus();

    assert.equal(preview.importableCount, 0);
    assert.equal(preview.blockedCount, 1);
    assert.equal(preview.documents[0].status, 'blocked');
    assert.equal(result.documentsImported, 0);
    assert.equal(result.chunksIndexed, 0);
    assert.equal(result.failures.length, 1);
    assert.match(result.failures[0].message, /readable KB article content/);
    assert.equal(stats.documentCount, 0);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('deletes a KB source and its indexed chunks', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-delete-store-'));

  try {
    const service = new KbService({
      store: new KbStore({
        storageDir,
        embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
      }),
    });
    await service.ensureReady();

    await service.importFromFiles(
      [
        markdownFile(
          'longhorn-replica.md',
          [
            '# Longhorn Replica Recovery',
            '',
            'Replica recovery requires checking the engine, manager logs, and disk scheduling status.',
            'After replacing a failed replica, monitor rebuilding progress and validate the workload mount.',
          ].join('\n'),
        ),
      ],
      { productType: 'longhorn' },
    );

    const before = await service.getStatus();
    assert.equal(before.documentCount, 1);
    assert.equal(before.chunkCount, 1);
    assert.equal(before.sources.length, 1);

    const deleted = await service.deleteSource(before.sources[0].id);
    const after = await service.getStatus();

    assert.equal(deleted.removedChunks, 1);
    assert.equal(after.documentCount, 0);
    assert.equal(after.chunkCount, 0);
    assert.deepEqual(after.sources, []);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('enriches finding groups with related KB matches', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-enrich-'));

  try {
    const store = new KbStore({
      storageDir,
      embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
    });
    await store.ensureReady();
    await store.upsertDocuments([
      normalizeKbDocument({
        sourceUri: 'https://longhorn.io/kb/troubleshooting-volume-pvc-xxx-not-scheduled/',
        contentType: 'text/html',
        content: longhornArticleHtml({
          title: 'Troubleshooting: `volume pvc-xxx not scheduled`',
          body: [
            '<h2>Details</h2>',
            '<p>Replica scheduling can fail when nodes do not have enough storage.</p>',
            '<p>Review disk capacity, replica count, node selectors, and anti-affinity settings.</p>',
          ].join('\n'),
        }),
      }),
    ]);

    const service = new KbService({ store });
    const report = await service.enrichReport({
      productType: 'longhorn',
      inventory: {
        metadata: {
          issuedescription: 'volume degraded and replica scheduling failed',
        },
      },
      findingGroups: [
        {
          id: 'longhorn-replica-scheduling-capacity',
          title: 'Replica scheduling is constrained by capacity or disk availability',
          description: 'Manager logs show replica creation prechecks failing because disks were not usable.',
          impact: 'Longhorn may be unable to restore the desired replica count.',
          affected: ['Scheduling log matches: 4'],
          recommendedChecks: ['Review free space, reserved space, disk tags, and node selectors.'],
          evidence: ['Precheck failed for creating new replica: insufficient storage'],
          relatedFindingIds: ['longhorn-log-replica-scheduling-storage'],
        },
      ],
      findings: [
        {
          id: 'longhorn-log-replica-scheduling-storage',
          title: 'Replica scheduling is hitting storage pressure',
          description: 'Replica creation precheck failures related to insufficient disk space.',
          evidence: ['insufficient storage'],
        },
      ],
    });

    assert.equal(report.kbSummary.enabled, true);
    assert.equal(report.findingGroups[0].relatedKb[0].title, 'Troubleshooting: `volume pvc-xxx not scheduled`');
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

function fixtureFetch(pages) {
  return async (url) => {
    const body = pages[url];

    if (!body) {
      return new Response('not found', { status: 404 });
    }

    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'text/html; charset=utf-8',
      },
    });
  };
}

function markdownFile(name, content) {
  return {
    name,
    size: Buffer.byteLength(content, 'utf8'),
    type: 'text/markdown',
    async text() {
      return content;
    },
  };
}

function longhornArticleHtml({ title, body }) {
  return `
    <html>
      <head><title>${title} | The Longhorn Knowledge Base</title></head>
      <body>
        <section class="hero"><div class="docs-content"><p class="title">${title}</p></div></section>
        <section class="section">
          <div class="docs-content">
            <div class="content is-medium has-extra-bottom-padding">
              <h2>Applicable versions</h2>
              <p>All Longhorn versions.</p>
              ${body}
            </div>
          </div>
          <a class="button is-primary" href="..">Back to Knowledge Base</a>
        </section>
      </body>
    </html>
  `;
}
