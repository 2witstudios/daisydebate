import type { Fixture, Id, Result } from '../shapes/competition';
import type { EventRequest, Plan } from '../shapes/draw';
import { effectiveCutoff, placedOf, sidesOf } from './context';
import {
  countedResults,
  entriesIn,
  oneReading,
  pastFixtures,
  pastResults,
  type PastFixture,
} from './past';
import type { Violation } from './verdict';

/**
 * One unit of an elimination round: entries meeting in a room, a bye, or (two
 * sides only) an empty bracket slot that keeps its place and sends nobody.
 */
type Unit = readonly Id[];

/** What the bracket says this tab round holds, or which needed results are missing. */
export type Progression =
  | { readonly kind: 'round'; readonly fixtures: readonly string[] }
  | { readonly kind: 'missing'; readonly fixtures: readonly (Id | null)[] };

/**
 * Seed numbers of the standard seeded tree in bracket order, `size` a power
 * of two: each seed s of the half-size tree opens out to s and size+1-s, the
 * pair turned round at every other position (for 8: 1 8, 5 4, 3 6, 7 2).
 */
export const seedOrder = (size: number): readonly number[] => {
  let order = [1];
  while (order.length < size) {
    const next = order.length * 2;
    order = order.flatMap((s, i) =>
      i % 2 === 0 ? [s, next + 1 - s] : [next + 1 - s, s],
    );
  }
  return order;
};

/** Dealt into `k` rooms by snake: across on even rows, back on odd ones. */
const snake = (ordered: readonly Id[], k: number): Id[][] => {
  const rooms: Id[][] = Array.from({ length: k }, () => []);
  ordered.forEach((entry, i) => {
    const row = Math.floor(i / k);
    const col = i % k;
    rooms[row % 2 === 0 ? col : k - 1 - col]!.push(entry);
  });
  return rooms;
};

/** A comparable name for a fixture: a two-sided pairing in side order, a room or section as a set. */
export const fixtureName = (fixture: Fixture): string => {
  switch (fixture.kind) {
    case 'bye':
      return `bye ${fixture.entry}`;
    case 'pairing':
      return fixture.sides.length === 2
        ? `${fixture.sides[0]} v ${fixture.sides[1]}`
        : `room {${[...fixture.sides].sort().join(', ')}}`;
    case 'section':
      return `section {${[...fixture.speakers].sort().join(', ')}}`;
  }
};

type Format = 'two' | 'four' | 'speakers';

const unitName = (format: Format, unit: Unit): string | null => {
  if (unit.length === 0) return null;
  if (unit.length === 1) return `bye ${unit[0]}`;
  if (format === 'two') return `${unit[0]} v ${unit[1]}`;
  const set = [...unit].sort().join(', ');
  return format === 'four' ? `room {${set}}` : `section {${set}}`;
};

/** Every unit of the first round from the seeds. */
const firstRound = (
  format: Format,
  seeds: readonly Id[],
  target: number,
): Unit[] => {
  const n = seeds.length;
  switch (format) {
    case 'two': {
      let size = 1;
      while (size < n) size *= 2;
      const order = seedOrder(Math.max(2, size));
      const units: Unit[] = [];
      for (let i = 0; i < order.length; i += 2) {
        const pair = [order[i]!, order[i + 1]!]
          .filter((s) => s <= n)
          .sort((a, b) => a - b);
        units.push(pair.map((s) => seeds[s - 1]!));
      }
      return units;
    }
    case 'four':
      return dealFour(seeds);
    case 'speakers':
      return snake(seeds, Math.max(1, Math.round(n / target)));
  }
};

/** Four sides: the top (n mod 4) seeds take byes, the rest are dealt into rooms of four by snake. */
const dealFour = (ordered: readonly Id[]): Unit[] => {
  const byes = ordered.length % 4;
  const rest = ordered.slice(byes);
  return [
    ...ordered.slice(0, byes).map((e) => [e]),
    ...snake(rest, rest.length / 4),
  ];
};

/** The history fixture of `round` that holds exactly the unit's entries. */
const findFixture = (
  fixtures: readonly PastFixture[],
  round: number,
  unit: Unit,
): PastFixture | undefined => {
  const want = [...unit].sort().join('\u0000');
  return fixtures.find(
    (f) =>
      f.tabRound === round &&
      f.fixture.kind !== 'bye' &&
      [...entriesIn(f.fixture)].sort().join('\u0000') === want,
  );
};

/** The progression of an elimination stage up to the tab round requested. */
export const progression = (request: EventRequest): Progression | null => {
  const stage = request.stage;
  if (stage.kind !== 'elimination') return null;
  const seeds = stage.bracket.seeds;
  const rank = new Map(seeds.map((id, i) => [id, i]));
  const bySeed = (a: Id, b: Id) =>
    (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity);
  const sides = sidesOf(request);
  const format: Format =
    sides === 2 ? 'two' : sides === 4 ? 'four' : 'speakers';
  const target = request.settings['pairing.section_size'].target;
  const fixtures = pastFixtures(request.history);
  const reading = oneReading(
    countedResults(
      fixtures,
      pastResults(request.history),
      effectiveCutoff(request),
    ),
  );
  const rounds = [
    ...new Set(
      fixtures
        .filter((f) => f.tabRound < request.tabRound)
        .map((f) => f.tabRound),
    ),
  ].sort((a, b) => a - b);
  let units = firstRound(format, seeds, target);
  for (const round of rounds) {
    const missing: (Id | null)[] = [];
    const outcomes = units.map((unit): Result | 'bye' | null => {
      if (unit.length < 2) return 'bye';
      const held = findFixture(fixtures, round, unit);
      const result = held === undefined ? undefined : reading.get(held.id);
      if (result === undefined) {
        missing.push(held?.id ?? null);
        return null;
      }
      return result;
    });
    if (missing.length > 0) return { kind: 'missing', fixtures: missing };
    /** Who each unit sends on. */
    const onward = units.map((unit, i): Id[] => {
      const outcome = outcomes[i]!;
      if (outcome === 'bye' || outcome === null) return [...unit];
      switch (outcome.outcome.kind) {
        case 'winner':
          return outcome.outcome.winner === null
            ? []
            : [outcome.outcome.winner];
        case 'ranking': {
          const places = new Map(
            outcome.outcome.places.map((p) => [p.entry, p.place]),
          );
          const take = format === 'four' ? 2 : Math.ceil(unit.length / 2);
          return [...unit]
            .sort(
              (a, b) =>
                (places.get(a) ?? Infinity) - (places.get(b) ?? Infinity) ||
                bySeed(a, b),
            )
            .slice(0, take);
        }
      }
    });
    if (format === 'two') {
      const next: Unit[] = [];
      for (let i = 0; i + 1 < onward.length; i += 2)
        next.push([...onward[i]!, ...onward[i + 1]!].sort(bySeed));
      units = next;
    } else {
      const going = onward.flat().sort(bySeed);
      units =
        format === 'four'
          ? dealFour(going)
          : snake(going, Math.max(1, Math.round(going.length / target)));
    }
  }
  return {
    kind: 'round',
    fixtures: units.flatMap((u) => {
      const name = unitName(format, u);
      return name === null ? [] : [name];
    }),
  };
};

const multisetDifference = (
  expected: readonly string[],
  actual: readonly string[],
) => {
  const left = [...actual];
  const missing: string[] = [];
  for (const name of expected) {
    const at = left.indexOf(name);
    if (at < 0) missing.push(name);
    else left.splice(at, 1);
  }
  return { missing: missing.sort(), extra: left.sort() };
};

/** Fact 2b: an elimination round holds exactly the fixtures its bracket and results give. */
export const bracketViolations = (
  request: EventRequest,
  plan: Plan,
): Violation[] => {
  const p = progression(request);
  if (p === null) return [];
  if (p.kind === 'missing')
    return [
      {
        kind: 'bracket_result_missing',
        event: request.event,
        fixtures: p.fixtures,
      },
    ];
  const { missing, extra } = multisetDifference(
    p.fixtures,
    placedOf(plan).map(({ fixture }) => fixtureName(fixture)),
  );
  return missing.length === 0 && extra.length === 0
    ? []
    : [{ kind: 'bracket_mismatch', event: request.event, missing, extra }];
};
