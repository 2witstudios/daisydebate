import type { Bye, Id, TwoSidePairing, TwoSides } from '../shapes/competition';
import type { RequestOf } from '../shapes/draw';
import type { PreliminaryMethod } from '../shapes/settings';
import { byeRecipientTerm } from '../settings/registry';
import {
  addVectors,
  compareVectors,
  packLexicographic,
} from '../solve/lexicographic';
import { minimumCostPerfectMatching } from '../solve/matching';
import { entriesOf, pairKey, type EventFacts } from './facts';
import {
  brokenRules,
  poolOf,
  preferenceFields,
  wordFor,
  type PlacementAnswer,
} from './placement';

export const TWO_SIDED_VERSION = 'pairing-two-sided@1';

type Fixture2 = TwoSidePairing | Bye;
const BYE = '\u0000bye';

/** The within-group method's cost of pairing ranks i < j of a group of g. */
export const methodCost = (
  method: PreliminaryMethod['later'],
  i: number,
  j: number,
  g: number,
) => {
  switch (method) {
    case 'fold':
      return Math.abs(i + j - (g - 1));
    case 'slide':
      return Math.abs(j - i - Math.floor(g / 2));
    case 'adjacent':
      return i % 2 === 0 && j === i + 1 ? 0 : Math.abs(j - i - 1) + 1;
    case 'random':
    case 'top_down':
      return 0;
  }
};

type Candidate = {
  readonly fixture: Fixture2;
  readonly fields: readonly number[];
};

type Solved = {
  readonly fixtures: readonly Candidate[];
  readonly total: readonly number[];
};

/** Minimum-cost perfect matching over cost vectors, or null when none exists. */
const solve = (
  vertices: readonly Id[],
  candidate: (a: Id, b: Id) => Candidate | null,
): Solved | null => {
  const edges: [number, number, Candidate][] = [];
  vertices.forEach((a, i) =>
    vertices.slice(i + 1).forEach((b, k) => {
      const found = candidate(a, b);
      if (found !== null) edges.push([i, i + 1 + k, found]);
    }),
  );
  const weights = packLexicographic(
    edges.map(([, , c]) => c.fields),
    vertices.length / 2,
  );
  const mate = minimumCostPerfectMatching(
    vertices.length,
    edges.map(([i, j], k) => [i, j, weights[k]!] as const),
  );
  if (mate === null) return null;
  const chosen = edges.filter(([i, j]) => mate[i] === j).map(([, , c]) => c);
  const width = edges[0]?.[2].fields.length ?? 0;
  return {
    fixtures: chosen,
    total: chosen.reduce<readonly number[]>(
      (sum, c) => addVectors(sum, c.fields),
      Array(width).fill(0),
    ),
  };
};

export const placeTwoSided = (
  request: RequestOf<TwoSides>,
  facts: EventFacts,
  seed: Uint8Array,
  structure: 'matched' | 'prematched',
  method: {
    readonly later: PreliminaryMethod['later'];
    readonly grouped: boolean;
  },
): PlacementAnswer => {
  const pool = poolOf(request, entriesOf);
  const vertices = pool.length % 2 === 1 ? [...pool, BYE] : pool;
  const movable = request.existing.filter((f) => f.hold === 'movable');
  const movableFor = new Map(
    movable.map((f) => [pairKey(...pairOfFixture(f.fixture)), f] as const),
  );
  const tie = (a: Id, b: Id) =>
    wordFor(seed, request.event, 'pairing/tiebreak', pairKey(a, b));

  const orientations = (
    a: Id,
    b: Id,
  ): { fixture: Fixture2; kept: boolean }[] => {
    /**
     * A movable fixture for this pair is offered as kept, beside the fresh
     * orientations: if keeping it breaks a rule it is withdrawn, never the
     * pair's edge lost.
     */
    const existing = movableFor.get(pairKey(a, b));
    const kept =
      existing === undefined ? [] : [{ fixture: existing.fixture, kept: true }];
    if (a === BYE || b === BYE)
      return [
        ...kept,
        { fixture: { kind: 'bye', entry: a === BYE ? b : a }, kept: false },
      ];
    return [
      ...kept,
      { fixture: { kind: 'pairing', sides: [a, b], panel: [] }, kept: false },
      { fixture: { kind: 'pairing', sides: [b, a], panel: [] }, kept: false },
    ];
  };

  /** Each pair's admissible orientations and their fields, computed once for both passes. */
  const base = new Map<
    string,
    { word: number; options: { fixture: Fixture2; fields: number[] }[] } | null
  >();
  const optionsOf = (a: Id, b: Id) => {
    const key = pairKey(a, b);
    if (base.has(key)) return base.get(key)!;
    const made =
      structure === 'prematched' &&
      a !== BYE &&
      b !== BYE &&
      (facts.meetings.get(key) ?? 0) > 0
        ? null
        : {
            word: tie(a, b),
            options: orientations(a, b)
              .filter(({ fixture }) => brokenRules(facts, fixture).length === 0)
              .map(({ fixture, kept }) => ({
                fixture,
                fields: [
                  kept ? 0 : 1,
                  ...preferenceFields(
                    facts,
                    fixture,
                    byeRecipientTerm(facts, fixture),
                  ),
                ],
              })),
          };
    base.set(key, made);
    return made;
  };

  const candidate =
    (extra: (fixture: Fixture2) => number) =>
    (a: Id, b: Id): Candidate | null => {
      const known = optionsOf(a, b);
      if (known === null) return null;
      const word = known.word;
      const options = known.options.map(({ fixture, fields }) => ({
        fixture,
        fields: [...fields, extra(fixture), word >>> 16],
      }));
      const sorted = options.sort((x, y) => compareVectors(x.fields, y.fields));
      if (
        sorted.length >= 2 &&
        compareVectors(sorted[0]!.fields, sorted[1]!.fields) === 0
      )
        return sorted[word & 1]!;
      return sorted[0] ?? null;
    };

  const first = solve(
    vertices,
    candidate(() => 0),
  );
  if (first === null) return { kind: 'infeasible' };
  const fixtures = method.grouped
    ? regroup(first, facts, method.later, candidate)
    : first.fixtures.map((c) => c.fixture);

  const keptIds = new Set<Id>();
  const added: Fixture2[] = [];
  for (const fixture of fixtures) {
    const existing = movableFor.get(pairKey(...pairOfFixture(fixture)));
    if (existing !== undefined && sameFixture(existing.fixture, fixture))
      keptIds.add(existing.id);
    else added.push(fixture);
  }
  const strength = (f: Fixture2) =>
    f.kind === 'bye'
      ? Infinity
      : Math.min(...f.sides.map((e) => facts.strength.get(e) ?? 0));
  return {
    kind: 'placed',
    placed: {
      kept: request.existing
        .filter((f) => f.hold === 'fixed' || keptIds.has(f.id))
        .map((f) => ({ id: f.id, fixture: f.fixture })),
      added: added.sort(
        (x, y) =>
          strength(x) - strength(y) ||
          (pairKey(...pairOfFixture(x)) < pairKey(...pairOfFixture(y))
            ? -1
            : 1),
      ),
      withdrawn: movable.filter((f) => !keptIds.has(f.id)).map((f) => f.id),
    },
  };
};

const pairOfFixture = (fixture: Fixture2): [Id, Id] =>
  fixture.kind === 'bye'
    ? [fixture.entry, BYE]
    : [fixture.sides[0], fixture.sides[1]];

const sameFixture = (a: Fixture2, b: Fixture2) =>
  a.kind === 'bye' || b.kind === 'bye'
    ? a.kind === b.kind && pairOfFixture(a)[0] === pairOfFixture(b)[0]
    : a.sides[0] === b.sides[0] && a.sides[1] === b.sides[1];

/**
 * The second pass: the first matching fixed which entries sit in each record
 * group (a pulled-up entry joins the group above). Re-matching each group
 * with the method's field below every higher field keeps the first pass's
 * optimum and adds the method.
 */
const regroup = (
  first: Solved,
  facts: EventFacts,
  later: PreliminaryMethod['later'],
  candidate: (
    extra: (fixture: Fixture2) => number,
  ) => (a: Id, b: Id) => Candidate | null,
): Fixture2[] => {
  const groups = new Map<number, Id[]>();
  const out: Fixture2[] = [];
  for (const { fixture } of first.fixtures) {
    if (fixture.kind === 'bye') {
      out.push(fixture);
      continue;
    }
    const top = Math.max(...fixture.sides.map((e) => facts.record.get(e) ?? 0));
    groups.set(top, [...(groups.get(top) ?? []), ...fixture.sides]);
  }
  for (const [, members] of [...groups].sort(([a], [b]) => b - a)) {
    const ranked = [...members].sort(
      (a, b) => (facts.strength.get(a) ?? 0) - (facts.strength.get(b) ?? 0),
    );
    const rank = new Map(ranked.map((e, i) => [e, i]));
    const field = (fixture: Fixture2) => {
      if (fixture.kind === 'bye') return 0;
      const [i, j] = fixture.sides
        .map((e) => rank.get(e)!)
        .sort((x, y) => x - y);
      return methodCost(later, i!, j!, ranked.length);
    };
    const group =
      later === 'top_down'
        ? topDown(
            ranked,
            candidate(() => 0),
          )
        : solve(ranked, candidate(field));
    out.push(
      ...(
        group ??
        solve(
          ranked,
          candidate(() => 0),
        )!
      ).fixtures.map((c) => c.fixture),
    );
  }
  return out;
};

/**
 * Greedy top-down (IPDA): rank by rank, the highest-ranked opponent that
 * still leaves a matching as good as the best one in every higher field.
 */
const topDown = (
  ranked: readonly Id[],
  candidate: (a: Id, b: Id) => Candidate | null,
): Solved | null => {
  const best = solve(ranked, candidate);
  if (best === null) return null;
  const higher = (fields: readonly number[]) => fields.slice(0, -1);
  const target = higher(best.total);
  let free = [...ranked];
  const chosen: Candidate[] = [];
  let spent = target.map(() => 0);
  while (free.length > 0) {
    const [top, ...rest] = free;
    let picked: { c: Candidate; partner: Id } | null = null;
    for (const partner of rest) {
      const pair = candidate(top!, partner);
      if (pair === null) continue;
      const remainder = solve(
        rest.filter((v) => v !== partner),
        candidate,
      );
      if (remainder === null) continue;
      const total = addVectors(
        addVectors(spent, higher(pair.fields)),
        higher(remainder.total),
      );
      if (compareVectors(total, target) === 0) {
        picked = { c: pair, partner };
        break;
      }
    }
    if (picked === null) return best;
    chosen.push(picked.c);
    spent = addVectors(spent, higher(picked.c.fields));
    free = rest.filter((v) => v !== picked.partner);
  }
  return { fixtures: chosen, total: best.total };
};
