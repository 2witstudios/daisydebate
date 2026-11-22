import type { ChatMessage } from './openrouter';
import type { BallotDefinition } from '@daisy/protocol/ballot-definition';
import type { Side } from '@daisy/protocol/seats';
import { ballotInstructions, judgeRubric } from './judge-instructions';
import {
  evidenceRules,
  transcriptEvidence,
  type TranscriptEvidenceInput,
} from './transcript-evidence';

/** The worker maps only the actual immutable freeze; identity and actor kind never enter this prompt. */
export function roundJudgeMessages(
  input: TranscriptEvidenceInput,
  definition: BallotDefinition,
  sides: readonly Side[],
): ChatMessage[] {
  return [
    {
      role: 'system',
      content: `${judgeRubric(definition, sides)}\n${evidenceRules}`,
    },
    {
      role: 'user',
      content: [
        `Resolution: ${JSON.stringify(input.resolution)}. Judge the sides and seats only from this frozen evidence.`,
        `Frozen evidence:\n${JSON.stringify(transcriptEvidence(input))}`,
        ballotInstructions(definition, sides),
      ].join('\n\n'),
    },
  ];
}
