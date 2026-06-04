import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { GeminiEmbeddingProvider } from '../src/kb/geminiEmbeddingProvider.js';
import { KbStore } from '../src/kb/kbStore.js';
import { LocalEmbeddingProvider } from '../src/kb/localEmbeddingProvider.js';

test('Gemini embedding provider sends embedContent requests with retrieval task config', async () => {
  const expectedVector = Array.from({ length: 128 }, (_, index) => index / 128);
  let capturedUrl = null;
  let capturedOptions = null;
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-api-key',
    model: 'gemini-embedding-001',
    dimensions: 128,
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/',
    fetchImpl: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;

      return new Response(
        JSON.stringify({
          embedding: {
            values: expectedVector,
          },
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
          },
        },
      );
    },
  });

  const vector = await provider.embedText('Longhorn replica scheduling', {
    taskType: 'RETRIEVAL_QUERY',
  });
  const requestBody = JSON.parse(capturedOptions.body);

  assert.equal(capturedUrl, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent');
  assert.equal(capturedOptions.method, 'POST');
  assert.equal(capturedOptions.headers['x-goog-api-key'], 'test-api-key');
  assert.equal(requestBody.model, 'models/gemini-embedding-001');
  assert.equal(requestBody.content.parts[0].text, 'Longhorn replica scheduling');
  assert.equal(requestBody.embedContentConfig.taskType, 'RETRIEVAL_QUERY');
  assert.equal(requestBody.embedContentConfig.outputDimensionality, 128);
  assert.deepEqual(vector, expectedVector);
});

test('Gemini embedding provider reports API errors clearly', async () => {
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-api-key',
    dimensions: 128,
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
    () => provider.embedText('Longhorn volume'),
    /Gemini embedding request failed with HTTP 404: model not found/,
  );
});

test('Gemini embedding provider skips remote calls for empty text', async () => {
  let calls = 0;
  const provider = new GeminiEmbeddingProvider({
    apiKey: 'test-api-key',
    dimensions: 128,
    fetchImpl: async () => {
      calls += 1;
      return new Response('{}');
    },
  });

  const vector = await provider.embedText('   ');

  assert.equal(calls, 0);
  assert.equal(vector.length, 128);
  assert.equal(vector.every((value) => value === 0), true);
});

test('KB store starts a fresh index when embedding descriptor changes', async () => {
  const storageDir = await fs.mkdtemp(path.join(os.tmpdir(), 'kb-embedding-switch-'));

  try {
    const firstStore = new KbStore({
      storageDir,
      embeddingProvider: new LocalEmbeddingProvider({ dimensions: 64 }),
    });
    await firstStore.ensureReady();
    await firstStore.upsertDocuments([
      {
        id: 'kb://longhorn/replica',
        title: 'Longhorn Replica Scheduling',
        sourceUri: 'https://longhorn.io/kb/replica',
        productType: 'longhorn',
        contentType: 'text/markdown',
        body: 'Replica scheduling depends on usable disks and enough free space.',
      },
    ]);

    const firstStats = await firstStore.getStats();
    assert.equal(firstStats.documentCount, 1);

    const secondStore = new KbStore({
      storageDir,
      embeddingProvider: new LocalEmbeddingProvider({ dimensions: 128 }),
    });
    const secondStats = await secondStore.getStats();

    assert.equal(secondStats.documentCount, 0);
    assert.equal(secondStats.chunkCount, 0);
    assert.deepEqual(secondStats.embedding, {
      provider: 'local-hash-v1',
      dimensions: 128,
    });
  } finally {
    await fs.rm(storageDir, { recursive: true, force: true });
  }
});
