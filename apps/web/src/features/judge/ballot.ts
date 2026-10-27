import {
  ballotCategories,
  ballotLimits,
  ballotRubricVersion,
  ballotSchema,
  ballotScoreMax,
  debateSides,
  isLowPointWin,
  speakerTotal,
  type Ballot,
  type BallotCategory,
} from '@daisy/protocol';
import { accept, field, refuse, type Parsed } from '../forms/form-state';
import type { DebateSide as Side } from '@daisy/protocol';

/** A debater as the ballot shows them: their name and, when set, a photo. */
type BallotDebater = {
  readonly name: string;
  readonly avatarSrc?: string;
};
export type BallotDebaters = Readonly<Record<Side, BallotDebater>>;

/** The posted field for one side's score in one category. */
export const scoreField = (side: Side, category: string): string =>
  `${side}-${category}`;
export const feedbackField = (side: Side): string => `feedback-${side}`;

/** A rubric ballot read from form fields. */
export type PostedBallot = {
  readonly ballot: Ballot;
};

const scorePattern = new RegExp(`^[1-${ballotScoreMax}]$`);

/** A posted score: a single digit from 1 to the maximum, or nothing. */
export const readScore = (value: string | undefined): number | null =>
  value !== undefined && scorePattern.test(value) ? Number(value) : null;

/**
 * What a low-point confirmation is given for: the winner and both totals.
 * The confirmation posts this as its value, so one given for one result
 * never confirms another.
 */
export const lowPointKey = (
  winner: Side,
  scores: Readonly<Record<Side, Readonly<Record<BallotCategory, number>>>>,
): string =>
  `${winner}:${speakerTotal(scores.affirmative)}:${speakerTotal(scores.negative)}`;

/**
 * A text field as the judge counted it: the browser posts each line break as
 * two characters (CRLF) where the textarea's own limit counted one.
 */
const text = (form: FormData, name: string): string =>
  field(form, name).replace(/\r\n/g, '\n');

/**
 * A ballot, read from the posted form. One ballot per judge seat. The
 * judge must pick a winner (no draws), score all ten categories for both
 * sides, give a reason, and confirm a win on fewer points.
 */
export function parseBallot(
  form: FormData,
  debaters: BallotDebaters,
): Parsed<PostedBallot> {
  const winner = field(form, 'winner');
  if (!debateSides.some((side) => side === winner))
    return refuse(
      `Pick who won: ${debaters.affirmative.name} or ${debaters.negative.name}.`,
    );
  const scores = Object.fromEntries(
    debateSides.map((side) => [
      side,
      Object.fromEntries(
        ballotCategories.map((category) => [
          category,
          readScore(field(form, scoreField(side, category))),
        ]),
      ),
    ]),
  );
  const reason = text(form, 'reason');
  if (reason === '') return refuse('Write the reason for your decision.');
  if (reason.length > ballotLimits.reason)
    return refuse(
      `A reason is up to ${ballotLimits.reason} characters. Shorten it.`,
    );
  const feedback = Object.fromEntries(
    debateSides
      .map((side) => [side, text(form, feedbackField(side))] as const)
      .filter(([, text]) => text !== ''),
  );
  if (
    Object.values(feedback).some((text) => text.length > ballotLimits.feedback)
  )
    return refuse(
      `Feedback is up to ${ballotLimits.feedback} characters. Shorten it.`,
    );
  const parsed = ballotSchema.safeParse({
    rubricVersion: ballotRubricVersion,
    winner,
    scores,
    reason,
    feedback,
  });
  if (!parsed.success) return refuse('Score every category from 1 to 5.');
  const ballot = parsed.data;
  if (
    isLowPointWin(ballot.winner, ballot.scores) &&
    field(form, 'low-point') !== lowPointKey(ballot.winner, ballot.scores)
  )
    return refuse('Confirm the low-point win, or change the scores.');
  return accept({ ballot });
}
