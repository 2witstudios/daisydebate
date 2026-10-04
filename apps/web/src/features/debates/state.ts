import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import type { JudgeKind } from '../rooms/state';
import { endedTurn } from './turns';

/**
 * The mock debate's state, carried in the address: which turn it is on, who
 * judges, who the viewer is, and whether a ruling has been made. The real
 * debate (its start time, rules and ballots) replaces the reader of this
 * state and nothing else.
 */
type Viewer = 'debater' | 'judge' | 'outsider';

export type DebateQuery = {
  /** 1 to the last turn; one past it means speaking is over. */
  readonly turn: number;
  readonly judgeKind: JudgeKind;
  readonly viewer: Viewer;
  /** Who made the ruling, once there is one. */
  readonly ruledBy: JudgeKind | null;
  /** A recorded result (a debate from history), which a ruling must not recompute. */
  readonly outcome: Outcome | null;
};

export type Outcome = 'affirmative' | 'negative' | 'draw';

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

export function parseDebateQuery(params: SearchParams): DebateQuery {
  return {
    turn: z
      .string()
      .regex(/^[1-9]$/)
      .transform(Number)
      .pipe(z.number().max(endedTurn))
      .catch(2)
      .parse(first(params['turn'])),
    judgeKind: z
      .enum(['person', 'ai'])
      .catch('person')
      .parse(first(params['kind'])),
    viewer: z
      .enum(['debater', 'judge', 'outsider'])
      .catch('debater')
      .parse(first(params['as'])),
    ruledBy: z
      .enum(['person', 'ai'])
      .nullable()
      .catch(null)
      .parse(first(params['by']) ?? null),
    outcome: z
      .enum(['affirmative', 'negative', 'draw'])
      .nullable()
      .catch(null)
      .parse(first(params['win']) ?? null),
  };
}

export const debateHref = (id: string, query: DebateQuery): string => {
  const params = new URLSearchParams({
    turn: String(query.turn),
    kind: query.judgeKind,
    as: query.viewer,
  });
  if (query.ruledBy) params.set('by', query.ruledBy);
  if (query.outcome) params.set('win', query.outcome);
  return `/debates/${id}?${params.toString()}`;
};

/**
 * The placeholder AI judge rules at random. The mock cannot be random and
 * stay the same on reload, so the pick comes from the debate's id: it looks
 * arbitrary and is stable.
 */
export const placeholderOutcome = (id: string): 'affirmative' | 'negative' =>
  [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 2 === 0
    ? 'affirmative'
    : 'negative';
