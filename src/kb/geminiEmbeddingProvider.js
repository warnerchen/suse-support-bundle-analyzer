const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = 1536;
const DEFAULT_TIMEOUT_MS = 30000;
const MIN_OUTPUT_DIMENSIONS = 128;
const MAX_OUTPUT_DIMENSIONS = 3072;
const SUPPORTED_TASK_TYPES = new Set([
  'RETRIEVAL_DOCUMENT',
  'RETRIEVAL_QUERY',
  'SEMANTIC_SIMILARITY',
  'CLASSIFICATION',
  'CLUSTERING',
  'QUESTION_ANSWERING',
  'FACT_VERIFICATION',
  'CODE_RETRIEVAL_QUERY',
]);

export class GeminiEmbeddingProvider {
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    dimensions = DEFAULT_DIMENSIONS,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const normalizedApiKey = String(apiKey ?? '').trim();

    if (!normalizedApiKey) {
      throw new Error('GEMINI_API_KEY is required when KB_EMBEDDING_PROVIDER=gemini.');
    }

    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required for Gemini embeddings.');
    }

    if (!Number.isInteger(dimensions) || dimensions < MIN_OUTPUT_DIMENSIONS || dimensions > MAX_OUTPUT_DIMENSIONS) {
      throw new Error(
        `Gemini embedding dimensions must be an integer between ${MIN_OUTPUT_DIMENSIONS} and ${MAX_OUTPUT_DIMENSIONS}.`,
      );
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Gemini embedding timeout must be an integer greater than 0 ms.');
    }

    this.apiKey = normalizedApiKey;
    this.model = normalizeModel(model);
    this.dimensions = dimensions;
    this.baseUrl = String(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  get descriptor() {
    return {
      provider: 'gemini',
      model: this.model,
      dimensions: this.dimensions,
    };
  }

  async embedText(text, { taskType = 'RETRIEVAL_DOCUMENT' } = {}) {
    const normalizedText = String(text ?? '').trim();

    if (!normalizedText) {
      return new Array(this.dimensions).fill(0);
    }

    const normalizedTaskType = normalizeTaskType(taskType);
    const payload = {
      model: this.model,
      content: {
        parts: [
          {
            text: normalizedText,
          },
        ],
      },
      embedContentConfig: {
        taskType: normalizedTaskType,
        outputDimensionality: this.dimensions,
      },
    };
    const responseBody = await this.#postEmbedding(payload);
    const values = responseBody?.embedding?.values;

    if (!Array.isArray(values)) {
      throw new Error('Gemini embedding response did not include embedding.values.');
    }

    if (values.length !== this.dimensions) {
      throw new Error(
        `Gemini embedding response returned ${values.length} dimensions, expected ${this.dimensions}.`,
      );
    }

    const vector = values.map((value) => Number(value));

    if (!vector.every(Number.isFinite)) {
      throw new Error('Gemini embedding response included non-numeric vector values.');
    }

    return vector;
  }

  async #postEmbedding(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${encodeModelPath(this.model)}:embedContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await readResponseBody(response);

      if (!response.ok) {
        throw new Error(`Gemini embedding request failed with HTTP ${response.status}: ${formatErrorBody(body)}`);
      }

      return body;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Gemini embedding request timed out after ${this.timeoutMs} ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function normalizeModel(model) {
  const normalized = String(model ?? DEFAULT_MODEL).trim().replace(/^\/+/, '');

  if (!normalized) {
    return `models/${DEFAULT_MODEL}`;
  }

  return normalized.startsWith('models/') ? normalized : `models/${normalized}`;
}

function encodeModelPath(model) {
  return model.split('/').map(encodeURIComponent).join('/');
}

function normalizeTaskType(taskType) {
  const normalized = String(taskType ?? 'RETRIEVAL_DOCUMENT').trim().toUpperCase();

  if (!SUPPORTED_TASK_TYPES.has(normalized)) {
    throw new Error(`Unsupported Gemini embedding task type: ${taskType}`);
  }

  return normalized;
}

async function readResponseBody(response) {
  const text = await response.text();

  if (!text) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function formatErrorBody(body) {
  if (typeof body === 'string') {
    return body;
  }

  return body?.error?.message ?? JSON.stringify(body);
}
