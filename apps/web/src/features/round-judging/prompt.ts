import { caseMapWireSchema, type AiJudge } from '@daisy/ai-voice';
import type { JudgingStageInput } from '@daisy/protocol/round-judging-attempt';
import { transcriptEvidenceInput } from '../round-runtime/transcript-evidence';

type Frozen = Parameters<typeof transcriptEvidenceInput>[0];

/**
 * One coherency stage's provider request (ADR 0125): its messages, its
 * output contract and its token budget, all from the Round's own AI judge
 * (its frozen ballot definition over its sides). The case map is the long
 * answer.
 */
export function frozenStageRequest(
  judge: Pick<AiJudge, 'stageMessages' | 'ballotWireSchema'>,
  input: Frozen,
  due: JudgingStageInput,
) {
  const messages = judge.stageMessages(transcriptEvidenceInput(input), due);
  return due.stage === 'map'
    ? {
        messages,
        outputSchema: { name: 'case_map', schema: caseMapWireSchema },
        maxTokens: 16000,
      }
    : {
        messages,
        outputSchema: { name: 'ballot', schema: judge.ballotWireSchema },
        maxTokens: 6000,
      };
}
