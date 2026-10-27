import type { ChatMessage } from './openrouter';
import { DEFAULT_RUBRIC, ballotInstructions } from './judge-instructions';
import {
  evidenceRules,
  transcriptEvidence,
  type TranscriptEvidenceInput,
} from './transcript-evidence';

/** The worker maps only the actual immutable freeze; identity and actor kind never enter this prompt. */
export function roundJudgeMessages(
  input: TranscriptEvidenceInput,
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${DEFAULT_RUBRIC}\n${evidenceRules}`,
    },
    {
      role: 'user',
      content: [
        `Resolution: ${JSON.stringify(input.resolution)}. Judge the sides and seats only from this frozen evidence.`,
        `Frozen evidence:\n${JSON.stringify(transcriptEvidence(input))}`,
        ballotInstructions,
      ].join('\n\n'),
    },
  ];
}
