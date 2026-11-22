import {
  aiJudgeFor,
  transcriptLines,
  type TranscriptEvidenceInput,
} from '@daisy/ai-voice';
import { stubCaseMap } from '@daisy/ai-voice/testing';
import { daisyWinnerBallot } from '@daisy/protocol/ballot-definition';
import { twoSides } from '@daisy/protocol/seats';
import type { CallOptions, Placeholders } from './prompt-file';

const EVIDENCE = /Frozen evidence:\n(\{.*\})\n/;

/** The judge the bench studies: Daisy's winner ballot over the two-sided preset. */
export const benchJudge = aiJudgeFor(daisyWinnerBallot, {
  sides: twoSides,
  segments: [],
});

/** The exact evidence JSON inside production's first-pass prompt. */
const evidenceJson = (input: TranscriptEvidenceInput) => {
  const user = benchJudge
    .stageMessages(input, { stage: 'first' })
    .find((message) => message.role === 'user');
  const evidence = user && EVIDENCE.exec(user.content)?.[1];
  if (!evidence)
    throw new Error(
      'the production prompt no longer carries "Frozen evidence:"',
    );
  return evidence;
};

/**
 * Production's three coherency stages for this Round (ADR 0125), as the
 * bench's calls: the first pass, the case map, and the final judge, whose
 * case map is call 2's output. `swaps` names each exact text a placeholder
 * stands for, so an unedited prompt file expands to production's messages.
 */
export function productionPipeline(input: TranscriptEvidenceInput) {
  const calls: {
    readonly messages: ReturnType<typeof benchJudge.stageMessages>;
    readonly options: CallOptions;
  }[] = [
    {
      messages: benchJudge.stageMessages(input, { stage: 'first' }),
      options: { schema: 'ballot', maxTokens: 6000 },
    },
    {
      messages: benchJudge.stageMessages(input, { stage: 'map' }),
      options: { schema: 'case_map', maxTokens: 16000 },
    },
    {
      messages: benchJudge.stageMessages(input, {
        stage: 'final',
        caseMap: stubCaseMap,
      }),
      options: { schema: 'ballot', maxTokens: 6000 },
    },
  ];
  const swaps = [
    [evidenceJson(input), '{{evidence}}'],
    [transcriptLines(input), '{{transcript}}'],
    [JSON.stringify(stubCaseMap), '{{call2}}'],
  ] as const;
  return { calls, swaps };
}

export const placeholdersFor = (
  input: TranscriptEvidenceInput,
): Placeholders => ({
  evidence: evidenceJson(input),
  transcript: transcriptLines(input),
  resolution: input.resolution,
});
