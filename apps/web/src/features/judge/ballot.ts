import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { accept, field, refuse, type Parsed } from '../mock-form/form';

const decisions = ['affirmative', 'negative', 'draw'] as const;
type Decision = (typeof decisions)[number];

export const scoreChoices = [1, 2, 3, 4, 5] as const;

export type Ballot = {
  readonly decision: Decision;
  readonly affirmativeScore: number;
  readonly negativeScore: number;
  readonly reason: string;
};

const score = (value: string): number | null => {
  const number = Number(value);
  return Number.isInteger(number) && scoreChoices.some((s) => s === number)
    ? number
    : null;
};

/** A ballot, read from the posted form. One ballot per judge seat. */
export function parseBallot(form: FormData): Parsed<Ballot> {
  const decision = field(form, 'decision');
  if (!decisions.some((d) => d === decision))
    return refuse('Choose who won: the affirmative, the negative or a draw.');
  const affirmativeScore = score(field(form, 'affirmative-score'));
  const negativeScore = score(field(form, 'negative-score'));
  if (affirmativeScore === null || negativeScore === null)
    return refuse('Give each side a score from 1 to 5.');
  const reason = field(form, 'reason');
  if (reason === '') return refuse('Write the reason for your decision.');
  if (reason.length > 600)
    return refuse('A reason is up to 600 characters. Shorten it.');
  return accept({
    decision: decision as Decision,
    affirmativeScore,
    negativeScore,
    reason,
  });
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
  return { kind: 'open', title, debateHref };
}
