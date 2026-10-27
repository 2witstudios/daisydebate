import { createAppError } from '@daisy/errors';
import {
  roundAnalysisLimits,
  roundAnalysisReportSchema,
  roundAnalysisSkills,
  roundAnalysisVersion,
  type DebateSide,
  type RoundAnalysisReport,
  type RoundAnalysisSkill,
} from '@daisy/protocol';
import { modelJson } from './model-json';
import type { ChatMessage } from './openrouter';
import {
  evidenceRules,
  transcriptEvidence,
  type TranscriptEvidenceInput,
} from './transcript-evidence';

/** Earlier skill scores of the same debater, newest first. */
export type RoundAnalysisHistory = readonly Readonly<
  Record<RoundAnalysisSkill, number>
>[];

/**
 * The analyst reviews one debater's performance. It decides nothing, uses no
 * judging rubric and never sees a ballot.
 */
const ANALYST_ROLE = [
  'You are an experienced debate analyst reviewing one debater’s performance in a finished round, like a chess game review.',
  'You never decide or guess who won. You find the moments that shaped the round for this debater, what the strongest reply would have been, and what to change next time.',
  'Ground every point in a line that was actually said. Address the debater as "you".',
].join('\n');

const skillShape = roundAnalysisSkills
  .map((skill) => `"${skill}": {"score": 1, "note": "one sentence"}`)
  .join(', ');

const analysisInstructions = (withHistory: boolean) =>
  [
    'Return only a JSON object of this shape:',
    `{"analysisVersion": ${roundAnalysisVersion}, "summary": "one or two sentences", "improvements": ["the change that most improves your next round"], "keyMoments": [{"line": {"segment": 0, "sequence": 0}, "happened": "what was said", "mattered": "why it shaped the round", "strongestReply": "the best thing you could have said"}], "missedOpportunities": [{"line": {"segment": 0, "sequence": 0}, "argument": "the opponent argument or drop you left unused", "reply": "how to use it"}], "skills": {${skillShape}}, "patterns": ["a habit that recurs across your rounds"]}`,
    `A line is cited by its segmentSequence as "segment" and its sequence as "sequence", and must be a line in the evidence. At most ${roundAnalysisLimits.improvements} improvements, ${roundAnalysisLimits.keyMoments} key moments, ${roundAnalysisLimits.missedOpportunities} missed opportunities and ${roundAnalysisLimits.patterns} patterns; the summary is at most ${roundAnalysisLimits.summary} characters and every other text at most ${roundAnalysisLimits.item}. Every skill is scored 1 to 5.`,
    withHistory
      ? 'Patterns compare this round with the earlier skill scores given; name only what the scores and this round both show.'
      : 'There are no earlier rounds, so "patterns" is an empty array.',
  ].join('\n\n');

/**
 * The analysis of one debater seat from the frozen transcript evidence and,
 * when there is any, that debater's own earlier skill scores. Identity and
 * actor kind never enter this prompt.
 */
export function roundAnalysisMessages(input: {
  readonly evidence: TranscriptEvidenceInput;
  readonly seat: { readonly side: DebateSide; readonly slot: number };
  readonly history: RoundAnalysisHistory;
}): ChatMessage[] {
  const { evidence, seat, history } = input;
  const withHistory = history.length > 0;
  return [
    { role: 'system', content: `${ANALYST_ROLE}\n${evidenceRules}` },
    {
      role: 'user',
      content: [
        `Resolution: ${JSON.stringify(evidence.resolution)}. Analyse the ${seat.side} debater in slot ${seat.slot} only from this frozen evidence.`,
        `Frozen evidence:\n${JSON.stringify(transcriptEvidence(evidence))}`,
        ...(withHistory
          ? [
              `Earlier skill scores of this debater, newest first:\n${JSON.stringify(history.slice(0, roundAnalysisLimits.history))}`,
            ]
          : []),
        analysisInstructions(withHistory),
      ].join('\n\n'),
    },
  ];
}

const lineKey = (line: { segment: number; sequence: number }) =>
  `${line.segment}.${line.sequence}`;

/**
 * The analyst's answer as a validated report: its own shape and limits, and
 * every cited line present in the evidence, so no report points at speech
 * that never happened. Patterns need history. Anything else is an
 * infrastructure failure.
 */
export function parseRoundAnalysis(
  answer: string,
  input: {
    readonly evidence: Pick<TranscriptEvidenceInput, 'utterances'>;
    readonly history: RoundAnalysisHistory;
  },
): RoundAnalysisReport {
  const invalid = (cause?: unknown) =>
    createAppError(
      'INFRASTRUCTURE',
      'The analyst answered an invalid round analysis',
      cause,
    );
  const result = roundAnalysisReportSchema.safeParse(
    modelJson(answer, 'The analyst answered malformed JSON'),
  );
  if (!result.success) throw invalid(result.error);
  const report = result.data;
  const lines = new Set(
    input.evidence.utterances.map((line) =>
      lineKey({ segment: line.segmentSequence, sequence: line.sequence }),
    ),
  );
  const cited = [...report.keyMoments, ...report.missedOpportunities].map(
    (item) => lineKey(item.line),
  );
  if (!cited.every((key) => lines.has(key))) throw invalid();
  if (input.history.length === 0 && report.patterns.length > 0)
    throw invalid();
  return report;
}
