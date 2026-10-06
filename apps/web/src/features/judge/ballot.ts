import { z } from 'zod';
import {
  ballotCategories,
  ballotLimits,
  ballotRubricVersion,
  ballotSchema,
  isLowPointWin,
  type Ballot,
} from '@daisy/protocol';
import type { SearchParams } from '../access/decision';
import { accept, field, refuse, type Parsed } from '../mock-form/form';
import type { Side } from '../debates/turns';

const sides = ['affirmative', 'negative'] as const satisfies readonly Side[];

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

/** A read ballot, plus whether the judge also asked to report conduct. */
export type PostedBallot = {
  readonly ballot: Ballot;
  readonly reportConduct: boolean;
};

const score = (value: string): number | null => {
  const number = Number(value);
  return value !== '' && Number.isInteger(number) ? number : null;
};

/**
 * A ballot, read from the posted form. One ballot per judge seat. The
 * judge must pick a winner (no draws), score all ten categories for both
 * sides, give a reason, and confirm a win on fewer points.
 */
export function parseBallot(form: FormData): Parsed<PostedBallot> {
  const winner = field(form, 'winner');
  if (!sides.some((side) => side === winner)) return refuse('Pick who won.');
  const scores = Object.fromEntries(
    sides.map((side) => [
      side,
      Object.fromEntries(
        ballotCategories.map((category) => [
          category,
          score(field(form, scoreField(side, category))),
        ]),
      ),
    ]),
  );
  const reason = field(form, 'reason');
  if (reason === '') return refuse('Write the reason for your decision.');
  if (reason.length > ballotLimits.reason)
    return refuse(
      `A reason is up to ${ballotLimits.reason} characters. Shorten it.`,
    );
  const feedback = Object.fromEntries(
    sides
      .map((side) => [side, field(form, feedbackField(side))] as const)
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
    field(form, 'low-point') !== 'confirmed'
  )
    return refuse('Confirm the low-point win, or change the scores.');
  return accept({ ballot, reportConduct: field(form, 'conduct') === 'report' });
}

/** Where a ballot is, in the mock: not open yet, open, or submitted. */
export type BallotState = 'waiting' | 'open' | 'submitted';

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export const parseBallotState = (params: SearchParams): BallotState =>
  z
    .enum(['waiting', 'open', 'submitted'])
    .catch('open')
    .parse(first(params['state']));

const ballotHref = (debateId: string, state: BallotState): string =>
  `/judge/ballot/${debateId}?state=${state}`;

/** Where a posted ballot goes: its confirmation. Nothing is kept. */
export const ballotDestination = (debateId: string): string =>
  ballotHref(debateId, 'submitted');

export type BallotView =
  | {
      readonly kind: 'waiting';
      readonly title: string;
      readonly debateHref: string;
      readonly demoOpenHref: string;
    }
  | {
      readonly kind: 'open';
      readonly title: string;
      readonly debateHref: string;
      readonly debaters: BallotDebaters;
    }
  | {
      readonly kind: 'submitted';
      readonly title: string;
      readonly resultHref: string;
      readonly hubHref: string;
    };

/** What the ballot page shows for a state. */
export function ballotView(
  debateId: string,
  title: string,
  state: BallotState,
  debaters: BallotDebaters,
): BallotView {
  const debateHref = `/debates/${debateId}?turn=6&kind=person&as=judge`;
  if (state === 'waiting')
    return {
      kind: 'waiting',
      title,
      debateHref: `/debates/${debateId}?turn=3&kind=person&as=judge`,
      demoOpenHref: ballotHref(debateId, 'open'),
    };
  if (state === 'submitted')
    return {
      kind: 'submitted',
      title,
      resultHref: `/debates/${debateId}?turn=6&kind=person&as=judge&by=person`,
      hubHref: '/judge',
    };
  return { kind: 'open', title, debateHref, debaters };
}
