import type {
  BallotDefinition,
  CaseMap,
  JudgingStageInput,
  Side,
} from '@daisy/protocol';
import type { ChatMessage } from './openrouter';
import { ballotInstructions, scoringAnchors } from './judge-instructions';
import { roundJudgeMessages } from './round-judge';
import {
  evidenceRules,
  transcriptLines,
  type TranscriptEvidenceInput,
} from './transcript-evidence';

/**
 * Coherency judging (ADR 0125): three stages, one provider call each.
 *
 * - `first`: the single-call judge, kept as an internal record and never
 *   shown to the final judge.
 * - `map`: how each side's case is built (thesis, burdens, warrants) and how
 *   the round's arguments depend on each other, from the transcript alone.
 * - `final`: the official ballot, decided in dependency order from the
 *   transcript and the map.
 */

const proofRules =
  'Hold both sides to the same standard of proof. A debater saying that something was dropped, conceded or unanswered is a claim to check against the lines, not a fact. A named source or statistic without a warrant is an assertion, and figures a side contradicts within the round lose weight. Do not intervene with your own arguments.';

const caseMapSystem = [
  'You are an experienced, fair debate adjudicator. You map how each side’s case is built and how the arguments in the round depend on each other. You do not decide the round.',
  'A case has a structure: a thesis (the side’s answer to the resolution), the burdens that follow from it (what must be true for the thesis to hold, set by its framework and definitions), and the warrants for each burden (the reasons, examples and evidence given). An attack matters according to the level it reaches: winning the dispute over the framework decides which burdens the round is judged on, and defeating a premise removes every argument that depends on that premise, whether or not those arguments were answered by name.',
  'Credit only dependencies and links the speakers themselves drew; never invent one. A distinction a speaker draws is not a contradiction, and a concession means only what its whole exchange shows, with the limits the speaker attached.',
  proofRules,
  evidenceRules,
].join('\n');

const caseMapTask = `Map this round. Cite lines as segment.line (for example 1.7), and give node ids so dependencies can be traced: A for the affirmative thesis, A1 for its first burden, A1.2 for a warrant under it; N, N1, N1.2 for the negative.
- about: the central question the round turned on, in the debaters' terms, and each side's thesis.
- cases: each side's thesis, the framework it set (its standard, definitions and weighing mechanism, with lines), and its burdens with their warrants. A warrant's kind is reasoning, example, evidence or assertion.
- framework: what the sides disagreed about in how the round should be judged (or "none"), each line that contested the other side's standard, named or not, the ruling on which standard governs and why, from what was argued and who set which standard first, and the ids of the burdens the governing standard makes relevant.
- attacks: every attack, with the node it targets, the level it reaches, its kind, the lines that answered it, whether it succeeds and why, and the nodes it removes, each with the dependency the speakers drew.
- concessions: the words with their line, the limits the speaker attached in the same exchange (or "none"), the node they bear on, and whether they cut against the speaker's own case.
- coherence: places where a side's case contradicts its own thesis or burdens.
- standing: the node ids still standing for each side after the attacks and everything they remove.
Return only the JSON object.`;

const finalSystem = (definition: BallotDefinition, sides: readonly Side[]) =>
  [
    'You are an experienced, fair debate judge. You decide the round by the coherency of each side’s case: whether its thesis is still carried, through burdens that still stand, on warrants that still hold, once the opponent’s attacks and everything they remove are taken into account.',
    'Decide in dependency order: first the dispute over the framework, which settles which burdens the round is judged on; then, for each live burden, what still stands after the attacks and the arguments they remove; then which thesis is still carried coherently; and only then weigh what remains. An argument removed by a successful attack on its premise is not weighed, even if no one answered it by name. Credit only links the speakers drew.',
    proofRules,
    evidenceRules,
    ...(definition.points ? [scoringAnchors(definition.points, sides)] : []),
  ].join('\n');

/** What the scores must agree with: a low-point win is explained, or never allowed. */
const scoresRule = (definition: BallotDefinition): string => {
  if (!definition.points) return '';
  const allowed =
    definition.decision.kind !== 'winner' || definition.decision.lowPointWin;
  return allowed
    ? " The scores describe each side's performance against the anchors; if the losing side's total is higher, the reason must say why."
    : " The scores describe each side's performance against the anchors; the winner's total is never lower than the loser's.";
};

/** The reason is asked for under its hard limit, so a careful answer never meets it. */
const reasonMargin = 50;

const finalTask = (definition: BallotDefinition) =>
  `Decide the round. The transcript is the authority: correct the map wherever the cited lines do not support it, and say so in your reason if the correction matters to the decision.

The reason states the decision in dependency order: how the framework dispute was resolved, which of the opponent's arguments fell with a premise, what still stands for each side, and ${definition.decision.kind === 'winner' ? "why the winner's thesis is carried" : 'why the side placed first carries its thesis'}. Keep it under ${definition.written.reason.max - reasonMargin} characters.${scoresRule(definition)}`;

const resolutionLine = (input: TranscriptEvidenceInput) =>
  `Resolution: ${JSON.stringify(input.resolution)}`;

/** The case map's messages: the transcript alone, never a ballot. */
function caseMapMessages(input: TranscriptEvidenceInput): ChatMessage[] {
  return [
    { role: 'system', content: caseMapSystem },
    {
      role: 'user',
      content: [
        resolutionLine(input),
        transcriptLines(input),
        caseMapTask,
      ].join('\n\n'),
    },
  ];
}

/** The final judge's messages: the transcript and the map, never the first pass. */
function finalJudgeMessages(
  input: TranscriptEvidenceInput,
  caseMap: CaseMap,
  definition: BallotDefinition,
  sides: readonly Side[],
): ChatMessage[] {
  return [
    { role: 'system', content: finalSystem(definition, sides) },
    {
      role: 'user',
      content: [
        resolutionLine(input),
        transcriptLines(input),
        `A map of the round's cases and how its arguments depend on each other:\n${JSON.stringify(caseMap)}`,
        finalTask(definition),
        ballotInstructions(definition, sides),
      ].join('\n\n'),
    },
  ];
}

/**
 * One stage's messages, from the one frozen evidence and the Round's frozen
 * ballot definition. The case map is two-sided by contract, so the map and
 * final stages are asked only of a Round on the two-sided preset; the caller
 * (`aiJudgeFor`) holds that precondition.
 */
export function judgingStageMessages(
  evidence: TranscriptEvidenceInput,
  input: JudgingStageInput,
  definition: BallotDefinition,
  sides: readonly Side[],
): ChatMessage[] {
  if (input.stage === 'final')
    return finalJudgeMessages(evidence, input.caseMap, definition, sides);
  return input.stage === 'map'
    ? caseMapMessages(evidence)
    : roundJudgeMessages(evidence, definition, sides);
}
