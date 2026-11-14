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
  type ChatMessage,
  type OpenRouter,
} from './openrouter';
export { aiJudgeFor, type AiJudge, type AiJudgeRules } from './ai-judge';
export { parseRoundAnalysis, roundAnalysisMessages } from './round-analysis';
export {
  transcriptLines,
  type TranscriptEvidenceInput,
} from './transcript-evidence';
export { roundDebaterMessages } from './round-debater';
export { roundSpeakerMessages } from './round-speaker';
export { createTurnTaking, turnTakingSettings } from './turn-taking';

export { caseMapAnswer } from './judge';
export { caseMapWireSchema, judgeContractVersion } from './judge-contract';
export { createPhraseStream } from './speech';
