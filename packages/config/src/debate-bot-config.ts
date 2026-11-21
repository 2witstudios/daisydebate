import { z } from 'zod';
import { secret } from './secrets';

export const debateBotFields = {
  // AIDB: OpenRouter for AI debates (chat, TTS, STT). Optional: without it
  // AI debates are unavailable and nothing calls out.
  OPENROUTER_API_KEY: secret(z.string().regex(/^\S+$/)).optional(),
};
