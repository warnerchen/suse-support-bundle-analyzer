import fs from 'node:fs/promises';
import path from 'node:path';
import { chunkKbDocument } from './kbText.js';
import { cosineSimilarity, LocalEmbeddingProvider, tokenize } from './localEmbeddingProvider.js';

const INDEX_FILENAME = 'kb-index.json';

export class KbStore {
  constructor({ storageDir, embeddingProvider = new LocalEmbeddingProvider() }) {
    this.storageDir = storageDir;
    this.indexPath = path.join(storageDir, INDEX_FILENAME);
    this.embeddingProvider = embeddingProvider;
    this.state = null;
  }

  async ensureReady() {
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.#loadState();
  }

  async getStats() {
    const state = await this.#loadState();

    return {
      documentCount: state.documents.length,
      chunkCount: state.chunks.length,
      updatedAt: state.updatedAt,
      embedding: state.embedding,
      sources: sortSources(state.documents.map(toSourceSummary)),
    };
  }

  async listSources({ productType = null } = {}) {
    const state = await this.#loadState();
    const normalizedProductType = String(productType ?? '').trim().toLowerCase();
    const sources = normalizedProductType
      ? state.documents.filter((document) => document.productType === normalizedProductType)
      : state.documents;

    return sortSources(sources.map(toSourceSummary));
  }

  async upsertDocuments(documents) {
    const state = await this.#loadState();
    const now = new Date().toISOString();
    const acceptedDocuments = documents.filter((document) => document.body?.trim());
    const sourceKeys = new Set(acceptedDocuments.map((document) => document.sourceUri || document.id));
    const documentIds = new Set(acceptedDocuments.map((document) => document.id));

    if (!acceptedDocuments.length) {
      return {
        documentsImported: 0,
        chunksIndexed: 0,
        documentsSkipped: documents.length,
        totalDocuments: state.documents.length,
        totalChunks: state.chunks.length,
        updatedAt: state.updatedAt,
      };
    }

    state.documents = state.documents.filter(
      (document) => !documentIds.has(document.id) && !sourceKeys.has(document.sourceUri || document.id),
    );
    state.chunks = state.chunks.filter((chunk) => !documentIds.has(chunk.documentId));

    let importedDocuments = 0;
    let indexedChunks = 0;

    for (const document of acceptedDocuments) {
      const chunks = [];

      for (const chunk of chunkKbDocument(document)) {
        const searchText = `${document.title}\n${chunk.content}`;

        chunks.push({
          ...chunk,
          vector: await this.embeddingProvider.embedText(searchText, {
            taskType: 'RETRIEVAL_DOCUMENT',
          }),
          searchText: searchText.toLowerCase(),
        });
      }

      if (!chunks.length) {
        continue;
      }

      state.documents.push({
        id: document.id,
        title: document.title,
        sourceUri: document.sourceUri,
        productType: document.productType,
        contentType: document.contentType,
        importedAt: document.importedAt ?? now,
        charCount: document.body.length,
        chunkCount: chunks.length,
      });
      state.chunks.push(...chunks);
      importedDocuments += 1;
      indexedChunks += chunks.length;
    }

    state.updatedAt = now;
    state.embedding = this.embeddingProvider.descriptor;
    await this.#saveState(state);

    return {
      documentsImported: importedDocuments,
      chunksIndexed: indexedChunks,
      documentsSkipped: documents.length - importedDocuments,
      totalDocuments: state.documents.length,
      totalChunks: state.chunks.length,
      updatedAt: state.updatedAt,
    };
  }

  async search(query, { productType = null, limit = 5, minScore = 0.07 } = {}) {
    const state = await this.#loadState();

    if (!state.chunks.length || !String(query ?? '').trim()) {
      return [];
    }

    const queryVector = await this.embeddingProvider.embedText(query, {
      taskType: 'RETRIEVAL_QUERY',
    });
    const queryTokens = new Set(tokenize(query));
    const documentsById = new Map(state.documents.map((document) => [document.id, document]));
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

  async deleteDocument(id) {
    const state = await this.#loadState();
    const documentId = String(id ?? '').trim();
    const document = state.documents.find((candidate) => candidate.id === documentId);

    if (!document) {
      return null;
    }

    const chunksBefore = state.chunks.length;
    state.documents = state.documents.filter((candidate) => candidate.id !== documentId);
    state.chunks = state.chunks.filter((chunk) => chunk.documentId !== documentId);
    state.updatedAt = new Date().toISOString();
    await this.#saveState(state);

    return {
      ...toSourceSummary(document),
      removedChunks: chunksBefore - state.chunks.length,
      totalDocuments: state.documents.length,
      totalChunks: state.chunks.length,
      updatedAt: state.updatedAt,
    };
  }

  async #loadState() {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      this.state = JSON.parse(raw);

      if (!embeddingDescriptorsEqual(this.state.embedding, this.embeddingProvider.descriptor)) {
        this.state = emptyState(this.embeddingProvider.descriptor);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      this.state = emptyState(this.embeddingProvider.descriptor);
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

function emptyState(embedding) {
  const now = new Date().toISOString();

  return {
    version: 1,
    createdAt: now,
    updatedAt: null,
    embedding,
    documents: [],
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

function toSourceSummary(document) {
  return {
    id: document.id,
    title: document.title,
    sourceUri: document.sourceUri,
    productType: document.productType,
    contentType: document.contentType,
    importedAt: document.importedAt,
    charCount: document.charCount,
    chunkCount: document.chunkCount,
  };
}

function sortSources(sources) {
  return [...sources].sort((a, b) => String(b.importedAt ?? '').localeCompare(String(a.importedAt ?? '')));
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

  const excerpt = normalized.slice(start, start + 300);
  return `${start > 0 ? '...' : ''}${excerpt}${start + 300 < normalized.length ? '...' : ''}`;
}
