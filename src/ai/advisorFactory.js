import {
  AI_ADVISOR_PROVIDER,
  GEMINI_ADVISOR_MODEL,
  GEMINI_ADVISOR_TIMEOUT_MS,
  GEMINI_API_BASE_URL,
  GEMINI_API_KEY,
} from '../config.js';
import { AiAdvisorService } from './aiAdvisorService.js';
import { GeminiAdvisorProvider } from './geminiAdvisorProvider.js';

export function createAiAdvisorService({ logger = null } = {}) {
  if (AI_ADVISOR_PROVIDER === 'off') {
    return null;
  }

  if (AI_ADVISOR_PROVIDER === 'gemini') {
    return new AiAdvisorService({
      provider: new GeminiAdvisorProvider({
        apiKey: GEMINI_API_KEY,
        model: GEMINI_ADVISOR_MODEL,
        baseUrl: GEMINI_API_BASE_URL,
        timeoutMs: GEMINI_ADVISOR_TIMEOUT_MS,
      }),
      logger,
    });
  }

  throw new Error(`Unsupported AI advisor provider: ${AI_ADVISOR_PROVIDER}`);
}
