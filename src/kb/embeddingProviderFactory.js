import {
  GEMINI_API_BASE_URL,
  GEMINI_API_KEY,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_EMBEDDING_TIMEOUT_MS,
  KB_EMBEDDING_DIMENSIONS,
  KB_EMBEDDING_PROVIDER,
} from '../config.js';
import { GeminiEmbeddingProvider } from './geminiEmbeddingProvider.js';
import { LocalEmbeddingProvider } from './localEmbeddingProvider.js';

export function createKbEmbeddingProvider({ fetchImpl = globalThis.fetch } = {}) {
  if (KB_EMBEDDING_PROVIDER === 'gemini') {
    return new GeminiEmbeddingProvider({
      apiKey: GEMINI_API_KEY,
      model: GEMINI_EMBEDDING_MODEL,
      dimensions: KB_EMBEDDING_DIMENSIONS,
      baseUrl: GEMINI_API_BASE_URL,
      timeoutMs: GEMINI_EMBEDDING_TIMEOUT_MS,
      fetchImpl,
    });
  }

  return new LocalEmbeddingProvider({ dimensions: KB_EMBEDDING_DIMENSIONS });
}
