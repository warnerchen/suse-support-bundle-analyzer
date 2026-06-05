import fs from 'node:fs/promises';
import path from 'node:path';
import { chunkKbDocument } from './kbText.js';
import { LocalEmbeddingProvider, tokenize } from './localEmbeddingProvider.js';
import { LocalVectorStore } from './localVectorStore.js';

const INDEX_FILENAME = 'kb-index.json';

export class KbStore {
  constructor({ storageDir, embeddingProvider = new LocalEmbeddingProvider(), vectorStore = null, logger = null }) {
    this.storageDir = storageDir;
    this.indexPath = path.join(storageDir, INDEX_FILENAME);
    this.embeddingProvider = embeddingProvider;
    this.vectorStore = vectorStore ?? new LocalVectorStore({ storageDir });
    this.logger = logger;
    this.state = null;
    this.legacyChunks = [];
    this.vectorStoreReady = false;
  }

  async ensureReady() {
    await fs.mkdir(this.storageDir, { recursive: true });
    await this.#loadState();
    await this.#ensureVectorStoreReady();
  }

  async getStats() {
    const state = await this.#loadState();
    await this.#ensureVectorStoreReady();
    const vectorStats = await this.vectorStore.getStats();

    return {
      documentCount: state.documents.length,
      chunkCount: vectorStats.chunkCount,
      updatedAt: latestTimestamp(state.updatedAt, vectorStats.updatedAt),
      embedding: vectorStats.embedding,
      vectorStore: vectorStats.vectorStore,
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
    await this.#ensureVectorStoreReady();
    const now = new Date().toISOString();
    const acceptedDocuments = documents.filter((document) => document.body?.trim());
    const sourceKeys = new Set(acceptedDocuments.map((document) => document.sourceUri || document.id));
    const documentIds = new Set(acceptedDocuments.map((document) => document.id));
    const vectorStats = await this.vectorStore.getStats();

    if (!acceptedDocuments.length) {
      return {
        documentsImported: 0,
        chunksIndexed: 0,
        documentsSkipped: documents.length,
        totalDocuments: state.documents.length,
        totalChunks: vectorStats.chunkCount,
        updatedAt: state.updatedAt,
      };
    }

    const removedDocumentIds = state.documents
      .filter((document) => documentIds.has(document.id) || sourceKeys.has(document.sourceUri || document.id))
      .map((document) => document.id);

    state.documents = state.documents.filter(
      (document) => !documentIds.has(document.id) && !sourceKeys.has(document.sourceUri || document.id),
    );

    for (const documentId of removedDocumentIds) {
      await this.vectorStore.deleteDocumentChunks(documentId);
    }

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

      const documentSummary = {
        id: document.id,
        title: document.title,
        sourceUri: document.sourceUri,
        productType: document.productType,
        contentType: document.contentType,
        importedAt: document.importedAt ?? now,
        charCount: document.body.length,
        chunkCount: chunks.length,
      };

      state.documents.push(documentSummary);
      await this.vectorStore.upsertDocumentChunks(documentSummary.id, chunks);
      importedDocuments += 1;
      indexedChunks += chunks.length;
    }

    state.updatedAt = now;
    state.embedding = this.embeddingProvider.descriptor;
    state.vectorStore = this.vectorStore.descriptor;
    await this.#saveState(state);
    const updatedVectorStats = await this.vectorStore.getStats();

    return {
      documentsImported: importedDocuments,
      chunksIndexed: indexedChunks,
      documentsSkipped: documents.length - importedDocuments,
      totalDocuments: state.documents.length,
      totalChunks: updatedVectorStats.chunkCount,
      updatedAt: state.updatedAt,
    };
  }

  async search(query, { productType = null, limit = 5, minScore = 0.07 } = {}) {
    const state = await this.#loadState();
    await this.#ensureVectorStoreReady();

    if (!String(query ?? '').trim()) {
      return [];
    }

    const queryVector = await this.embeddingProvider.embedText(query, {
      taskType: 'RETRIEVAL_QUERY',
    });
    const queryTokens = new Set(tokenize(query));

    return this.vectorStore.search(queryVector, queryTokens, state.documents, {
      productType,
      limit,
      minScore,
    });
  }

  async deleteDocument(id) {
    const state = await this.#loadState();
    await this.#ensureVectorStoreReady();
    const documentId = String(id ?? '').trim();
    const document = state.documents.find((candidate) => candidate.id === documentId);

    if (!document) {
      return null;
    }

    state.documents = state.documents.filter((candidate) => candidate.id !== documentId);
    const vectorDelete = await this.vectorStore.deleteDocumentChunks(documentId);
    state.updatedAt = new Date().toISOString();
    await this.#saveState(state);

    return {
      ...toSourceSummary(document),
      removedChunks: vectorDelete.removedChunks,
      totalDocuments: state.documents.length,
      totalChunks: vectorDelete.totalChunks,
      updatedAt: state.updatedAt,
    };
  }

  async #loadState() {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await fs.readFile(this.indexPath, 'utf8');
      const parsed = JSON.parse(raw);

      if (!embeddingDescriptorsEqual(parsed.embedding, this.embeddingProvider.descriptor)) {
        this.state = emptyState(this.embeddingProvider.descriptor);
        this.legacyChunks = [];
      } else {
        this.legacyChunks = Array.isArray(parsed.chunks) ? parsed.chunks : [];
        this.state = normalizeState(parsed, this.embeddingProvider.descriptor, this.vectorStore.descriptor);
      }
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }

      this.state = emptyState(this.embeddingProvider.descriptor);
    }

    return this.state;
  }

  async #ensureVectorStoreReady() {
    if (this.vectorStoreReady) {
      return;
    }

    await this.vectorStore.ensureReady({ embedding: this.embeddingProvider.descriptor });
    this.vectorStoreReady = true;

    if (this.legacyChunks.length && (await this.vectorStore.isEmpty())) {
      const migratedChunks = this.legacyChunks.length;
      await this.vectorStore.replaceAllChunks(this.legacyChunks);
      this.legacyChunks = [];
      await this.#saveState(this.state);
      this.logger?.info('kb.legacy_vectors_migrated', {
        chunkCount: migratedChunks,
        vectorStore: this.vectorStore.descriptor,
      });
    }
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
    vectorStore: null,
    documents: [],
  };
}

function normalizeState(state, embedding, vectorStore) {
  return {
    version: state.version ?? 1,
    createdAt: state.createdAt ?? new Date().toISOString(),
    updatedAt: state.updatedAt ?? null,
    embedding,
    vectorStore: state.vectorStore ?? vectorStore,
    documents: Array.isArray(state.documents) ? state.documents : [],
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

function latestTimestamp(left, right) {
  if (!left) {
    return right ?? null;
  }

  if (!right) {
    return left;
  }

  return left > right ? left : right;
}
