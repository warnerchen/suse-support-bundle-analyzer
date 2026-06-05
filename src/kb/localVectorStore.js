import fs from 'node:fs/promises';
import path from 'node:path';
import { cosineSimilarity } from './localEmbeddingProvider.js';

const VECTOR_INDEX_FILENAME = 'kb-vectors.json';

export class LocalVectorStore {
  constructor({ storageDir }) {
    this.storageDir = storageDir;
    this.indexPath = path.join(storageDir, VECTOR_INDEX_FILENAME);
    this.state = null;
    this.embedding = null;
  }

  get descriptor() {
    return {
      provider: 'local-json-v1',
    };
  }

  async ensureReady({ embedding }) {
    this.embedding = embedding;
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.#loadState();
  }

  async getStats() {
    const state = await this.#loadState();

    return {
      chunkCount: state.chunks.length,
      updatedAt: state.updatedAt,
      embedding: state.embedding,
      vectorStore: state.vectorStore,
    };
  }

  async isEmpty() {
    const state = await this.#loadState();
    return state.chunks.length === 0;
  }

  async replaceAllChunks(chunks) {
    const state = await this.#loadState();
    state.chunks = [...chunks];
    state.updatedAt = new Date().toISOString();
    state.embedding = this.embedding;
    state.vectorStore = this.descriptor;
    await this.#saveState(state);

    return state.chunks.length;
  }

  async upsertDocumentChunks(documentId, chunks) {
    const state = await this.#loadState();
    const normalizedDocumentId = String(documentId ?? '').trim();
    const before = state.chunks.length;

    state.chunks = state.chunks.filter((chunk) => chunk.documentId !== normalizedDocumentId);
    state.chunks.push(...chunks);
    state.updatedAt = new Date().toISOString();
    state.embedding = this.embedding;
    state.vectorStore = this.descriptor;
    await this.#saveState(state);

    return {
      removedChunks: before - (state.chunks.length - chunks.length),
      indexedChunks: chunks.length,
      totalChunks: state.chunks.length,
      updatedAt: state.updatedAt,
    };
  }

  async deleteDocumentChunks(documentId) {
    const state = await this.#loadState();
    const normalizedDocumentId = String(documentId ?? '').trim();
    const chunksBefore = state.chunks.length;

    state.chunks = state.chunks.filter((chunk) => chunk.documentId !== normalizedDocumentId);

    if (state.chunks.length === chunksBefore) {
      return {
        removedChunks: 0,
        totalChunks: state.chunks.length,
        updatedAt: state.updatedAt,
      };
    }

    state.updatedAt = new Date().toISOString();
    await this.#saveState(state);

    return {
      removedChunks: chunksBefore - state.chunks.length,
      totalChunks: state.chunks.length,
      updatedAt: state.updatedAt,
    };
  }

  async search(queryVector, queryTokens, documents, { productType = null, limit = 5, minScore = 0.07 } = {}) {
    const state = await this.#loadState();

    if (!state.chunks.length) {
      return [];
    }

    const documentsById = new Map(documents.map((document) => [document.id, document]));
    const bestByDocument = new Map();

    for (const chunk of state.chunks) {
      const document = documentsById.get(chunk.documentId);

      if (!document) {
        continue;
      }

      if (productType && document.productType !== 'unknown' && document.productType !== productType) {
        continue;
      }

      const vectorScore = cosineSimilarity(queryVector, chunk.vector);
      const keywordScore = keywordOverlapScore(queryTokens, chunk.searchText);
      const score = vectorScore * 0.72 + keywordScore * 0.28;

      if (score < minScore) {
        continue;
      }

      const candidate = {
        id: document.id,
        title: document.title,
        sourceUri: document.sourceUri,
        productType: document.productType,
        score: Number(score.toFixed(3)),
        excerpt: createExcerpt(chunk.content, queryTokens),
        chunkIndex: chunk.chunkIndex,
      };
      const existing = bestByDocument.get(document.id);

      if (!existing || candidate.score > existing.score) {
        bestByDocument.set(document.id, candidate);
      }
    }

    return [...bestByDocument.values()].sort((a, b) => b.score - a.score).slice(0, limit);
  }

  async #loadState() {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      this.state = JSON.parse(raw);

      if (!embeddingDescriptorsEqual(this.state.embedding, this.embedding)) {
        this.state = emptyVectorState(this.embedding, this.descriptor);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      this.state = emptyVectorState(this.embedding, this.descriptor);
    }

    return this.state;
  }

  async #saveState(state) {
    await fs.mkdir(this.storageDir, { recursive: true });

    const tmpPath = `${this.indexPath}.${Date.now()}.tmp`;
    await fs.writeFile(tmpPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await fs.rename(tmpPath, this.indexPath);
    this.state = state;
  }
}

function emptyVectorState(embedding, vectorStore) {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: null,
    embedding,
    vectorStore,
    chunks: [],
  };
}

function embeddingDescriptorsEqual(left, right) {
  return JSON.stringify(normalizeEmbeddingDescriptor(left)) === JSON.stringify(normalizeEmbeddingDescriptor(right));
}

function normalizeEmbeddingDescriptor(descriptor) {
  return {
    provider: descriptor?.provider ?? null,
    model: descriptor?.model ?? null,
    dimensions: descriptor?.dimensions ?? null,
  };
}

function keywordOverlapScore(queryTokens, text) {
  if (!queryTokens.size) {
    return 0;
  }

  let hits = 0;

  for (const token of queryTokens) {
    if (text.includes(token)) {
      hits += 1;
    }
  }

  return hits / Math.sqrt(queryTokens.size * Math.max(queryTokens.size, 3));
}

function createExcerpt(content, queryTokens) {
  const normalized = content.replace(/\s+/g, ' ').trim();
  let start = 0;

  for (const token of queryTokens) {
    const index = normalized.toLowerCase().indexOf(token);

    if (index !== -1) {
      start = Math.max(0, index - 90);
      break;
    }
  }

  const excerpt = normalized.slice(start, start + 260);
  return `${start ? '...' : ''}${excerpt}${start + excerpt.length < normalized.length ? '...' : ''}`;
}
