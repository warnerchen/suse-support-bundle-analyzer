const DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_MODEL = 'gemini-2.0-flash';
const DEFAULT_TIMEOUT_MS = 45000;
const PROMPT_VERSION = 'support-advisor-v1';

const SYSTEM_PROMPT = [
  'You are an expert SUSE technical support advisor for support bundle analysis.',
  'Use only the provided structured analyzer output and related KB matches.',
  'Do not invent product state that is not present in the evidence.',
  'If KB matches are weak or missing, give investigation next steps based on the strongest errors and facts.',
  'Return concise JSON only. Do not wrap it in Markdown.',
  'Every suggestion must cite evidence strings from the input when possible.',
  'Provide both English and Simplified Chinese user-facing text.',
].join('\n');

export class GeminiAdvisorProvider {
  constructor({
    apiKey,
    model = DEFAULT_MODEL,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    fetchImpl = globalThis.fetch,
  } = {}) {
    const normalizedApiKey = String(apiKey ?? '').trim();

    if (!normalizedApiKey) {
      throw new Error('GEMINI_API_KEY is required when AI_ADVISOR_PROVIDER=gemini.');
    }

    if (typeof fetchImpl !== 'function') {
      throw new Error('A fetch implementation is required for Gemini advisor requests.');
    }

    if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
      throw new Error('Gemini advisor timeout must be an integer greater than 0 ms.');
    }

    this.apiKey = normalizedApiKey;
    this.model = normalizeModel(model);
    this.baseUrl = String(baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.timeoutMs = timeoutMs;
    this.fetchImpl = fetchImpl;
  }

  get descriptor() {
    return {
      provider: 'gemini',
      model: this.model,
      promptVersion: PROMPT_VERSION,
    };
  }

  async generateAdvice(context) {
    const payload = {
      systemInstruction: {
        parts: [
          {
            text: SYSTEM_PROMPT,
          },
        ],
      },
      contents: [
        {
          role: 'user',
          parts: [
            {
              text: buildUserPrompt(context),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        responseMimeType: 'application/json',
      },
    };

    const body = await this.#postGenerateContent(payload);
    const text = extractCandidateText(body);
    const parsed = parseJsonResponse(text);

    return normalizeAdvice(parsed, this.descriptor);
  }

  async #postGenerateContent(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.fetchImpl(`${this.baseUrl}/${encodeModelPath(this.model)}:generateContent`, {
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
        throw new Error(`Gemini advisor request failed with HTTP ${response.status}: ${formatErrorBody(body)}`);
      }

      return body;
    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Gemini advisor request timed out after ${this.timeoutMs} ms.`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function buildUserPrompt(context) {
  return [
    'Analyze this support bundle report context and produce JSON with this schema:',
    JSON.stringify({
      summary: { en: 'short overall assessment', zhCN: '简短总体判断' },
      kbCoverage: {
        status: 'strong | partial | none',
        en: 'how useful the related KB matches are',
        zhCN: '相关 KB 匹配是否足够有帮助',
      },
      suggestions: [
        {
          priority: 'high | medium | low',
          confidence: 'high | medium | low',
          title: { en: 'action title', zhCN: '操作标题' },
          rationale: { en: 'why this matters', zhCN: '为什么需要这样做' },
          actions: {
            en: ['concrete next step'],
            zhCN: ['具体下一步'],
          },
          evidence: ['exact or summarized evidence string from input'],
          relatedKbTitles: ['KB title when relevant'],
        },
      ],
      questions: {
        en: ['question to ask customer if needed'],
        zhCN: ['需要向客户确认的问题'],
      },
      limitations: {
        en: ['important limitation'],
        zhCN: ['重要限制'],
      },
    }),
    'Input context:',
    JSON.stringify(context),
  ].join('\n\n');
}

function normalizeAdvice(value, descriptor) {
  const suggestions = Array.isArray(value?.suggestions) ? value.suggestions : [];
  const normalizedSuggestions = suggestions.slice(0, 6).map((suggestion) => ({
    priority: normalizeEnum(suggestion?.priority, ['high', 'medium', 'low'], 'medium'),
    confidence: normalizeEnum(suggestion?.confidence, ['high', 'medium', 'low'], 'medium'),
    title: normalizeLocalizedText(suggestion?.title),
    rationale: normalizeLocalizedText(suggestion?.rationale),
    actions: {
      en: normalizeStringArray(suggestion?.actions?.en ?? suggestion?.actions, 6),
      zhCN: normalizeStringArray(suggestion?.actions?.zhCN ?? suggestion?.actions?.['zh-CN'] ?? suggestion?.actions, 6),
    },
    evidence: normalizeStringArray(suggestion?.evidence, 6),
    relatedKbTitles: normalizeStringArray(suggestion?.relatedKbTitles, 5),
  }));

  return {
    enabled: true,
    status: 'generated',
    generatedAt: new Date().toISOString(),
    provider: descriptor.provider,
    model: descriptor.model,
    promptVersion: descriptor.promptVersion,
    summary: normalizeLocalizedText(value?.summary),
    kbCoverage: {
      status: normalizeEnum(value?.kbCoverage?.status, ['strong', 'partial', 'none'], 'none'),
      ...normalizeLocalizedText(value?.kbCoverage),
    },
    suggestions: normalizedSuggestions,
    questions: {
      en: normalizeStringArray(value?.questions?.en ?? value?.questions, 6),
      zhCN: normalizeStringArray(value?.questions?.zhCN ?? value?.questions?.['zh-CN'] ?? value?.questions, 6),
    },
    limitations: {
      en: normalizeStringArray(value?.limitations?.en ?? value?.limitations, 6),
      zhCN: normalizeStringArray(value?.limitations?.zhCN ?? value?.limitations?.['zh-CN'] ?? value?.limitations, 6),
    },
  };
}

function normalizeLocalizedText(value) {
  if (typeof value === 'string') {
    return {
      en: value,
      zhCN: value,
    };
  }

  return {
    en: String(value?.en ?? value?.text ?? '').trim(),
    zhCN: String(value?.zhCN ?? value?.['zh-CN'] ?? value?.cn ?? value?.en ?? value?.text ?? '').trim(),
  };
}

function normalizeStringArray(value, limit) {
  const values = Array.isArray(value) ? value : [value];

  return values
    .map((item) => String(item ?? '').trim())
    .filter(Boolean)
    .slice(0, limit);
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? '').trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function extractCandidateText(body) {
  const parts = body?.candidates?.[0]?.content?.parts ?? [];
  const text = parts
    .map((part) => part?.text ?? '')
    .join('\n')
    .trim();

  if (!text) {
    throw new Error('Gemini advisor response did not include candidate text.');
  }

  return text;
}

function parseJsonResponse(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {
    throw new Error(`Gemini advisor response was not valid JSON: ${error.message}`);
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
