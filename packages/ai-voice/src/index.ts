/**
 * The AI debate voice layer: an OpenRouter adapter for chat, speech (TTS)
 * and transcription (STT), the prompts that make the AI a debater and a
 * judge, and the pure speech helpers that fit a speech to its slot.
 * Self-hosted adapters can replace OpenRouter behind the same shapes later.
 */
export {
  createOpenRouter,
  type ChatMessage,
  type CompletionRequest,
  type Fetch,
  type OpenRouter,
} from './openrouter';
export {
  DEFAULT_PERSONA,
  DEFAULT_RUBRIC,
  cxMessages,
  judgeMessages,
  renderTranscript,
  speechMessages,
  type TranscriptEntry,
} from './prompts';
export { ballotSchema, parseBallot, type Ballot } from './judge';
export {
  createTurnTaking,
  defaultTurnTakingSettings,
  type TurnTaking,
  type TurnTakingEvent,
  type TurnTakingSettings,
} from './turn-taking';
export {
  DEFAULT_WORDS_PER_MINUTE,
  createSentenceBuffer,
  heardText,
  splitSentences,
  wordBudget,
} from './speech';

/** Default OpenRouter models per role, until the dashboard versions them. */
export const DEFAULT_MODELS = {
  speech: 'anthropic/claude-sonnet-5.5',
  cx: 'openai/gpt-6-luna',
  judge: 'anthropic/claude-sonnet-5.5',
  tts: 'hexgrad/kokoro-82m',
  stt: 'openai/whisper-large-v3-turbo',
} as const;

/** Kokoro voices the person can pick for their AI opponent. */
export const AI_VOICES = [
  { id: 'am_michael', label: 'Michael (US)' },
  { id: 'af_heart', label: 'Heart (US)' },
  { id: 'bm_george', label: 'George (UK)' },
  { id: 'bf_emma', label: 'Emma (UK)' },
] as const;
export type AiVoice = (typeof AI_VOICES)[number]['id'];
