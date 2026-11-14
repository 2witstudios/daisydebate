import { shuffleWith } from '@daisy/seeded-random';
import type { Bye, Id, TwoSidePairing, TwoSides } from '../shapes/competition';
import type { RequestOf } from '../shapes/draw';
import { entriesOf, type EventFacts } from './facts';
import {
  brokenRules,
  eventStream,
  poolOf,
  type PlacementAnswer,
} from './placement';

export const ROUND_ROBIN_VERSION = 'schedule-round-robin@1';

/**
 * Round robin by the circle method: entry 0 stays, the rest turn one place
 * per tab round, and sides alternate by position and round. Tab round k is a
 * function of the entries, the seed and k alone, so every tab round of the
 * stage can be drawn before any is played.
 */
export const roundRobinRound = (
  entries: readonly Id[],
  tabRound: number,
): (TwoSidePairing | Bye)[] => {
  const circle: (Id | null)[] =
    entries.length % 2 === 1 ? [...entries, null] : [...entries];
  const n = circle.length;
  if (n < 2) return entries.map((entry) => ({ kind: 'bye', entry }));
  const turn = (tabRound - 1) % (n - 1);
  const rest = circle.slice(1);
  const turned = [
    circle[0]!,
    ...rest.slice(rest.length - turn),
    ...rest.slice(0, rest.length - turn),
  ];
  return Array.from({ length: n / 2 }, (_, i) => {
    const a = turned[i]!;
    const b = turned[n - 1 - i]!;
    if (a === null || b === null)
      return { kind: 'bye', entry: (a ?? b)! } as const;
    const swap = (i + tabRound) % 2 === 1;
    return {
      kind: 'pairing',
      sides: swap ? [b, a] : [a, b],
      panel: [],
    } as const;
  });
};

export const placeRoundRobin = (
  request: RequestOf<TwoSides>,
  facts: EventFacts,
  seed: Uint8Array,
): PlacementAnswer => {
  const pool = poolOf(request, entriesOf);
  const order = shuffleWith(pool, eventStream(seed, request.event, 'schedule'));
  const fixtures = roundRobinRound(order, request.tabRound);
  if (fixtures.some((fixture) => brokenRules(facts, fixture).length > 0))
    return { kind: 'infeasible' };
  const movable = request.existing.filter((f) => f.hold === 'movable');
  const same = (a: TwoSidePairing | Bye, b: TwoSidePairing | Bye) =>
    JSON.stringify(entriesOf(a)) === JSON.stringify(entriesOf(b)) &&
    a.kind === b.kind;
  const kept = movable.filter((f) =>
    fixtures.some((fixture) => same(f.fixture, fixture)),
  );
  return {
    kind: 'placed',
    placed: {
      kept: request.existing
        .filter((f) => f.hold === 'fixed' || kept.includes(f))
        .map((f) => ({ id: f.id, fixture: f.fixture })),
      added: fixtures.filter(
        (fixture) => !kept.some((f) => same(f.fixture, fixture)),
      ),
      withdrawn: movable.filter((f) => !kept.includes(f)).map((f) => f.id),
    },
  };
};
