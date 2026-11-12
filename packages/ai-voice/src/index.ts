/**
 * The AI debate voice layer: an OpenRouter adapter for chat, speech (TTS)
 * and transcription (STT), the prompts that make the AI a debater and a
 * judge, the round analysis prompt, CX turn-taking, and the pure helpers that fit a speech to its slot.
 */
export {
  createOpenRouter,
  isDefiniteProviderFailure,
  isTransientProviderFailure,
  isUnhealableProviderRefusal,
  type OpenRouter,
} from './openrouter';
export { roundJudgeMessages } from './round-judge';
export { parseRoundAnalysis, roundAnalysisMessages } from './round-analysis';
export type { TranscriptEvidenceInput } from './transcript-evidence';
export { roundDebaterMessages } from './round-debater';
export { createTurnTaking, turnTakingSettings } from './turn-taking';

export { judgeAnswer, type JudgedAnswer } from './judge';
export { ballotWireSchema, judgeContractVersion } from './judge-contract';
export { createPhraseStream } from './speech';
