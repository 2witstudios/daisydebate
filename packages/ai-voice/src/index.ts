/**
 * The AI debate voice layer: an OpenRouter adapter for chat, speech (TTS)
 * and transcription (STT), the prompts that make the AI a debater and a
 * judge, the round analysis prompt, CX turn-taking, and the pure helpers that fit a speech to its slot.
 */
export {
  createOpenRouter,
  isDefiniteProviderFailure,
  isTransientProviderFailure,
  type OpenRouter,
} from './openrouter';
export { roundJudgeMessages } from './round-judge';
export {
  parseRoundAnalysis,
  roundAnalysisMessages,
  type RoundAnalysisHistory,
} from './round-analysis';
export type { TranscriptEvidenceInput } from './transcript-evidence';
export { roundDebaterMessages } from './round-debater';
export { createTurnTaking, defaultTurnTakingSettings } from './turn-taking';

export { parseBallot } from './judge';
export { phrasesOf, worthTranscribing } from './speech';
