import type { Fixture, Id } from '../shapes/competition';
import type {
  DrawInput,
  EventRequest,
  FixtureRef,
  Judge,
  Plan,
  SlotJudge,
} from '../shapes/draw';
import type { CostContext } from './costs';
import {
  countedResults,
  oneReading,
  pastFixtures,
  pastOf,
  pastResults,
  pullUpCounts,
  recordsBefore,
} from './past';

/** One fixture of a plan with the address the plan gives it. */
export type Placed = {
  readonly ref: FixtureRef;
  readonly fixture: Fixture;
  readonly added: boolean;
};

export const requestsOf = (input: DrawInput): readonly EventRequest[] =>
  input.call === 'slot' ? input.events : [input.event];

export const placedOf = (plan: Plan): readonly Placed[] => [
  ...plan.keep.map((k) => ({
    ref: { kind: 'existing', id: k.id } as const,
    fixture: k.fixture as Fixture,
    added: false,
  })),
  ...plan.add.map((a) => ({
    ref: { kind: 'new', ordinal: a.ordinal } as const,
    fixture: a.fixture as Fixture,
    added: true,
  })),
];

export const sameRef = (a: FixtureRef, b: FixtureRef) => {
  switch (a.kind) {
    case 'existing':
      return b.kind === 'existing' && a.id === b.id;
    case 'new':
      return b.kind === 'new' && a.ordinal === b.ordinal;
  }
};

export const judgesOf = (
  input: DrawInput,
): ReadonlyMap<Id, Judge | SlotJudge> | null =>
  input.judges === null
    ? null
    : new Map<Id, Judge | SlotJudge>(input.judges.map((j) => [j.id, j]));

/** Two sides, four sides, or null for speakers. */
export const sidesOf = (request: EventRequest): number | null =>
  request.format.outcome === 'winner'
    ? 2
    : request.format.of === 'sides'
      ? 4
      : null;

/** Whether this tab round weighs pull-ups: a powered preliminary round after the first, of pairings. */
const weighsPullUp = (request: EventRequest) =>
  request.stage.kind === 'preliminary' &&
  request.settings['pairing.method'].preliminary.structure === 'powered' &&
  request.tabRound > 1 &&
  sidesOf(request) !== null;

/** The costs' context for one event, counting results through `cutoff`. */
export const costContext = (
  input: DrawInput,
  request: EventRequest,
  cutoff: number,
): CostContext => {
  const fixtures = pastFixtures(request.history);
  const reading = oneReading(
    countedResults(fixtures, pastResults(request.history), cutoff),
  );
  const sides = sidesOf(request);
  const judges = judgesOf(input);
  return {
    request,
    entries: new Map(request.entries.map((e) => [e.id, e])),
    past: pastOf(fixtures, request.tabRound),
    records: weighsPullUp(request)
      ? recordsBefore(
          sides,
          fixtures,
          reading,
          request.settings,
          cutoff,
          request.tabRound,
        )
      : null,
    pulled: pullUpCounts(
      sides,
      fixtures,
      reading,
      request.settings,
      cutoff,
      request.tabRound,
    ),
    judges,
    leastLoad:
      input.judges === null || input.judges.length === 0
        ? 0
        : Math.min(...input.judges.map((j) => j.tabRoundsJudged)),
    slot: input.call === 'slot',
  };
};
