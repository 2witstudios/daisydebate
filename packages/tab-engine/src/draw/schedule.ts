import { canonicalOrder, shuffleWith } from '@daisy/seeded-random';
import type { Bye, Id, TwoSidePairing, TwoSides } from '../shapes/competition';
import type { RequestOf } from '../shapes/draw';
import { entriesOf, type EventFacts } from './facts';
import {
  brokenRules,
  eventStream,
  poolOf,
  placedFrom,
  type PlacementAnswer,
} from './placement';

export const ROUND_ROBIN_VERSION = 'schedule-round-robin@1';

/**
 * Round robin by the circle method: entry 0 stays, the rest turn one place
 * per tab round, and sides alternate by position and round. Tab round k is a
 * function of the entries, the seed and k alone, so every tab round of the
 * stage can be drawn before any is played.
 */
const roundRobinRound = (
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
  /**
   * The schedule is a function of every entry of the event (withdrawn ones
   * too), the seed and the tab round, so a drop or a re-draw with fixed
   * fixtures keeps the same circle. A scheduled fixture with an entry that
   * is withdrawn or already in a fixed fixture is set aside, and its other
   * entry takes the bye.
   */
  const everyone = canonicalOrder(request.entries).map((e) => e.id);
  const pool = new Set(poolOf(request, entriesOf));
  const order = shuffleWith(
    everyone,
    eventStream(seed, request.event, 'schedule'),
  );
  const fixtures = roundRobinRound(order, request.tabRound).flatMap(
    (fixture): (TwoSidePairing | Bye)[] => {
      const seated = entriesOf(fixture);
      if (seated.every((e) => pool.has(e))) return [fixture];
      return seated
        .filter((e) => pool.has(e))
        .map((entry) => ({ kind: 'bye', entry }));
    },
  );
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
    placed: placedFrom(
      request,
      kept,
      fixtures.filter((fixture) => !kept.some((f) => same(f.fixture, fixture))),
    ),
  };
};
