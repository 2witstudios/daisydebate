import {
  ballotWireSchema,
  caseMapWireSchema,
  judgingStageMessages,
} from '@daisy/ai-voice';
import type { JudgingStageInput } from '@daisy/protocol';
import { transcriptEvidenceInput } from '../round-runtime/transcript-evidence';

type Frozen = Parameters<typeof transcriptEvidenceInput>[0];

/**
 * One coherency stage's provider request (ADR 0125): its messages, its
 * output contract and its token budget. The case map is the long answer.
 */
export function frozenStageRequest(input: Frozen, due: JudgingStageInput) {
  const messages = judgingStageMessages(transcriptEvidenceInput(input), due);
  return due.stage === 'map'
    ? {
        messages,
        outputSchema: { name: 'case_map', schema: caseMapWireSchema },
        maxTokens: 16000,
      }
    : {
        messages,
        outputSchema: { name: 'ballot', schema: ballotWireSchema },
        maxTokens: 6000,
      };
}
