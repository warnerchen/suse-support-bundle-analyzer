import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { KbStore } from '../src/kb/kbStore.js';
import { normalizeKbDocument } from '../src/kb/kbText.js';
import { LocalEmbeddingProvider } from '../src/kb/localEmbeddingProvider.js';

test('migrates legacy KB chunks from kb-index.json into the local vector store', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-vector-migration-'));
  const embeddingProvider = new LocalEmbeddingProvider({ dimensions: 64 });
  const document = {
    id: 'kb://longhorn/legacy-replica',
    title: 'Longhorn Legacy Replica Scheduling',
    sourceUri: 'https://longhorn.io/kb/legacy-replica/',
    productType: 'longhorn',
    contentType: 'text/markdown',
    importedAt: '2026-06-05T00:00:00.000Z',
    charCount: 128,
    chunkCount: 1,
  };
  const chunkContent = 'Replica scheduling can fail when disks do not have enough free space.';
  const searchText = `${document.title}\n${chunkContent}`;
  const legacyIndex = {
    version: 1,
    createdAt: '2026-06-05T00:00:00.000Z',
    updatedAt: '2026-06-05T00:00:00.000Z',
    embedding: embeddingProvider.descriptor,
    documents: [document],
    chunks: [
      {
        documentId: document.id,
        chunkIndex: 0,
        content: chunkContent,
        vector: embeddingProvider.embedText(searchText),
        searchText: searchText.toLowerCase(),
      },
    ],
  };

  try {
    await fs.writeFile(path.join(storageDir, 'kb-index.json'), `${JSON.stringify(legacyIndex, null, 2)}\n`, 'utf8');

    const store = new KbStore({
      storageDir,
      embeddingProvider,
    });
    await store.ensureReady();

    const stats = await store.getStats();
    const metadata = JSON.parse(await fs.readFile(path.join(storageDir, 'kb-index.json'), 'utf8'));
    const vectors = JSON.parse(await fs.readFile(path.join(storageDir, 'kb-vectors.json'), 'utf8'));
    const matches = await store.search('replica scheduling free disk space', {
      productType: 'longhorn',
      limit: 1,
    });

    assert.equal(stats.documentCount, 1);
    assert.equal(stats.chunkCount, 1);
    assert.deepEqual(stats.vectorStore, { provider: 'local-json-v1' });
    assert.equal(metadata.chunks, undefined);
    assert.equal(vectors.chunks.length, 1);
    assert.equal(matches[0].title, document.title);
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});

test('serializes concurrent KB index writes', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-vector-concurrent-'));

  try {
    const store = new KbStore({
      storageDir,
      embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
    });
    await store.ensureReady();

    await Promise.all([
      store.upsertDocuments([
        normalizeKbDocument({
          sourceUri: 'uploaded://longhorn-replica.md',
          productType: 'longhorn',
          content: [
            '# Longhorn Replica Scheduling',
            '',
            'Replica scheduling can fail when usable disk capacity is exhausted across nodes.',
          ].join('\n'),
        }),
      ]),
      store.upsertDocuments([
        normalizeKbDocument({
          sourceUri: 'uploaded://harvester-vm.md',
          productType: 'harvester',
          content: [
            '# Harvester VM Scheduling',
            '',
            'VM scheduling can fail when node selectors or admission webhooks block placement.',
          ].join('\n'),
        }),
      ]),
    ]);

    const stats = await store.getStats();
    const sources = await store.listSources();

    assert.equal(stats.documentCount, 2);
    assert.equal(stats.chunkCount, 2);
    assert.deepEqual(
      sources.map((source) => source.productType).sort(),
      ['harvester', 'longhorn'],
    );
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});
