import {
  ballotWireSchema,
  caseMapWireSchema,
  judgingStageMessages,
  roundJudgeMessages,
} from '@daisy/ai-voice';
import type { CaseMap, JudgingStage } from '@daisy/protocol';
import { transcriptEvidenceInput } from '../round-runtime/transcript-evidence';

type Frozen = Parameters<typeof transcriptEvidenceInput>[0];

/** The first-pass judge's messages for a frozen Round. */
export const frozenJudgingMessages = (input: Frozen) =>
  roundJudgeMessages(transcriptEvidenceInput(input));

/**
 * One coherency stage's provider request (ADR 0125): its messages, its
 * output contract and its token budget. The case map is the long answer.
 */
export function frozenStageRequest(
  input: Frozen,
  stage: JudgingStage,
  caseMap: CaseMap | null,
) {
  const evidence = transcriptEvidenceInput(input);
  if (stage === 'map')
    return {
      messages: judgingStageMessages(evidence, { stage }),
      outputSchema: { name: 'case_map', schema: caseMapWireSchema },
      maxTokens: 16000,
    };
  if (stage === 'final' && !caseMap)
    throw new Error('The final stage needs the stored case map');
  return {
    messages: judgingStageMessages(
      evidence,
      stage === 'final' ? { stage, caseMap: caseMap! } : { stage },
    ),
    outputSchema: { name: 'ballot', schema: ballotWireSchema },
    maxTokens: 6000,
  };
}
