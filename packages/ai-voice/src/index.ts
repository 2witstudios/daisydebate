/**
 * The AI debate voice layer: an OpenRouter adapter for chat, speech (TTS)
 * and transcription (STT), the prompts that make the AI a debater and a
 * judge, CX turn-taking, and the pure helpers that fit a speech to its slot.
 */
export {
  createOpenRouter,
  isDefiniteProviderFailure,
  isTransientProviderFailure,
  type OpenRouter,
} from './openrouter';
export { roundCoachMessages, roundJudgeMessages } from './round-judge';
export { roundDebaterMessages } from './round-debater';
export { createTurnTaking, defaultTurnTakingSettings } from './turn-taking';

export { parseBallot, parseCoaching } from './judge';
export { phrasesOf, worthTranscribing } from './speech';
