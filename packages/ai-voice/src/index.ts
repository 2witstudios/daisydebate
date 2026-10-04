/**
 * The AI debate voice layer: an OpenRouter adapter for chat, speech (TTS)
 * and transcription (STT), the prompts that make the AI a debater and a
 * judge, CX turn-taking, and the pure helpers that fit a speech to its slot.
 * Self-hosted adapters can replace OpenRouter behind the same shapes later.
 */
export { createOpenRouter, type OpenRouter } from './openrouter';
export { readLines } from './lines';
export {
  cxMessages,
  debaterPersona,
  judgeMessages,
  speechMessages,
  type TranscriptEntry,
} from './prompts';
export { parseBallot, type Ballot } from './judge';
export { createTurnTaking, defaultTurnTakingSettings } from './turn-taking';
export {
  createSentenceBuffer,
  heardText,
  splitSentences,
  worthTranscribing,
} from './speech';

/**
 * Default OpenRouter models per role, until the dashboard versions them
 * (measured 2026-10-03: Sonnet 5.5 at low effort starts a six minute speech
 * in about 1.5 s and finishes writing it in about 15 s; GPT-6 Luna without
 * reasoning answers a CX question in under a second).
 */
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

/** Reasoning effort per role: quick for live turns, deeper for the judge. */
export const DEFAULT_REASONING = {
  speech: 'low',
  cx: 'none',
  judge: 'medium',
} as const;
