import {
  roundJudgeMessages,
  type TranscriptEvidenceInput,
} from '@daisy/ai-voice';
import type { Placeholders } from './prompt-file';

const EVIDENCE = /Frozen evidence:\n(\{.*\})\n/;

/** Production's own messages for this Round, and the exact evidence JSON inside them. */
export function productionPrompt(input: TranscriptEvidenceInput) {
  const messages = roundJudgeMessages(input);
  const user = messages.find((message) => message.role === 'user');
  const evidence = user && EVIDENCE.exec(user.content)?.[1];
  if (!evidence)
    throw new Error(
      'the production prompt no longer carries "Frozen evidence:"',
    );
  return { messages, evidence };
}

/** The same lines as the evidence, one per line, for a human-readable prompt. */
export function readableTranscript(input: TranscriptEvidenceInput): string {
  const lines = [...input.utterances]
    .sort(
      (a, b) =>
        a.segmentSequence - b.segmentSequence || a.sequence - b.sequence,
    )
    .map((line) => {
      const marks = [
        line.interrupted ? 'interrupted' : '',
        line.complete ? '' : 'incomplete',
      ].filter(Boolean);
      const mark = marks.length ? ` (${marks.join(', ')})` : '';
      return `[${line.segmentSequence}.${line.sequence}] ${line.side} ${line.slot}${mark}: ${line.text}`;
    });
  const gaps = input.gaps.map(
    (gap) =>
      `[${gap.sequence}] ${gap.side} ${gap.slot}: no audio captured from ${(gap.fromOffsetMs / 1000).toFixed(1)}s to ${(gap.untilOffsetMs / 1000).toFixed(1)}s (${gap.cause})`,
  );
  return [
    ...lines,
    ...(gaps.length ? ['', 'Capture gaps:', ...gaps] : []),
  ].join('\n');
}

export const placeholdersFor = (
  input: TranscriptEvidenceInput,
): Placeholders => ({
  evidence: productionPrompt(input).evidence,
  transcript: readableTranscript(input),
  resolution: input.resolution,
});
