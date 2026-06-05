import { KB_VECTOR_STORE } from '../config.js';
import { LocalVectorStore } from './localVectorStore.js';

export function createKbVectorStore({ storageDir }) {
  if (KB_VECTOR_STORE === 'local-json') {
    return new LocalVectorStore({ storageDir });
  }

  throw new Error(`Unsupported KB vector store: ${KB_VECTOR_STORE}`);
}
