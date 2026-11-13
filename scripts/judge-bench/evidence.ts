import {
  judgingStageMessages,
  transcriptLines,
  type TranscriptEvidenceInput,
} from '@daisy/ai-voice';
import { stubCaseMap } from '@daisy/ai-voice/testing';
import type { CallOptions, Placeholders } from './prompt-file';

const EVIDENCE = /Frozen evidence:\n(\{.*\})\n/;

/** The exact evidence JSON inside production's first-pass prompt. */
const evidenceJson = (input: TranscriptEvidenceInput) => {
  const user = judgingStageMessages(input, { stage: 'first' }).find(
    (message) => message.role === 'user',
  );
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
    readonly messages: ReturnType<typeof judgingStageMessages>;
    readonly options: CallOptions;
  }[] = [
    {
      messages: judgingStageMessages(input, { stage: 'first' }),
      options: { schema: 'ballot', maxTokens: 6000 },
    },
    {
      messages: judgingStageMessages(input, { stage: 'map' }),
      options: { schema: 'case_map', maxTokens: 16000 },
    },
    {
      messages: judgingStageMessages(input, {
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
