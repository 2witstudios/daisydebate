import { compareBytes } from '@daisy/seeded-random';
import type {
  Fixture,
  Id,
  Result,
  StageHistory,
  FormatDescriptor,
} from '../shapes/competition';
import type { ResolvedSettings } from '../shapes/settings';

/** A historic fixture with the format generics erased. */
export type PastFixture = {
  readonly id: Id;
  readonly tabRound: number;
  readonly fixture: Fixture;
};

export const pastFixtures = (
  history: StageHistory<FormatDescriptor>,
): readonly PastFixture[] => history.fixtures as readonly PastFixture[];
export const pastResults = (
  history: StageHistory<FormatDescriptor>,
): readonly Result[] => history.results as readonly Result[];

/** Every entry a fixture holds, in its own order. */
export const entriesIn = (fixture: Fixture): readonly Id[] => {
  switch (fixture.kind) {
    case 'pairing':
      return fixture.sides;
    case 'section':
      return fixture.speakers;
    case 'bye':
      return [fixture.entry];
  }
};

export const panelOf = (fixture: Fixture): readonly Id[] =>
  fixture.kind === 'bye' ? [] : fixture.panel;

/**
 * The results that count, by fixture: for every fixture of the history at or
 * before the cutoff, the results no other result supersedes, narrowed to those
 * with the longest chain of supersessions behind them. Several remain only
 * when the record itself is ambiguous; every one of them is a fair reading.
 */
export const countedResults = (
  fixtures: readonly PastFixture[],
  results: readonly Result[],
  cutoff: number,
): ReadonlyMap<Id, readonly Result[]> => {
  const counted = new Map<Id, Result[]>();
  if (cutoff <= 0) return counted;
  const byId = new Map(results.map((r) => [r.id, r]));
  const superseded = new Set(
    results.flatMap((r) => (r.supersedes === null ? [] : [r.supersedes])),
  );
  const chain = (result: Result): number => {
    const seen = new Set<Id>();
    let length = 0;
    let at: Result | undefined = result;
    while (at !== undefined && !seen.has(at.id)) {
      seen.add(at.id);
      length += 1;
      at = at.supersedes === null ? undefined : byId.get(at.supersedes);
    }
    return length;
  };
  const inWindow = new Set(
    fixtures.filter((f) => f.tabRound <= cutoff).map((f) => f.id),
  );
  for (const result of results) {
    if (superseded.has(result.id) || !inWindow.has(result.fixture)) continue;
    const held = counted.get(result.fixture);
    if (held === undefined) {
      counted.set(result.fixture, [result]);
      continue;
    }
    const best = chain(held[0]!);
    const mine = chain(result);
    if (mine > best) counted.set(result.fixture, [result]);
    else if (mine === best) held.push(result);
  }
  return counted;
};

/** One reading of the counted results: the least id among ties. */
export const oneReading = (
  counted: ReadonlyMap<Id, readonly Result[]>,
): ReadonlyMap<Id, Result> =>
  new Map(
    [...counted].map(([fixture, tied]) => [
      fixture,
      [...tied].sort((a, b) => compareBytes(a.id, b.id))[0]!,
    ]),
  );

/** Records scaled to integers; `exact` is false when a bye's worth is an average the checker does not restate. */
export type Records = {
  readonly of: (entry: Id) => number;
  readonly exact: boolean;
};

/**
 * Each entry's record from the counted results of fixtures before `beforeRound`:
 * wins in a two-sided format, team points 3/2/1/0 by place in a four-side one.
 */
export const recordsBefore = (
  sides: number | null,
  fixtures: readonly PastFixture[],
  reading: ReadonlyMap<Id, Result>,
  settings: ResolvedSettings,
  cutoff: number,
  beforeRound: number,
): Records => {
  const totals = new Map<Id, number>();
  const add = (entry: Id, amount: number) =>
    totals.set(entry, (totals.get(entry) ?? 0) + amount);
  let exact = true;
  for (const past of fixtures) {
    if (past.tabRound >= beforeRound || past.tabRound > cutoff) continue;
    if (past.fixture.kind === 'bye') {
      if (settings['bye.result'].value === 'win')
        add(past.fixture.entry, sides === 4 ? 3 : 1);
      else exact = false;
      continue;
    }
    const result = reading.get(past.id);
    if (result === undefined) continue;
    const outcome = result.outcome;
    switch (outcome.kind) {
      case 'winner':
        if (outcome.winner !== null) add(outcome.winner, 1);
        break;
      case 'ranking':
        for (const { entry, place } of outcome.places)
          add(entry, Math.max(0, 4 - place));
        break;
    }
  }
  return { of: (entry) => totals.get(entry) ?? 0, exact };
};

/** What the earlier tab rounds say about each entry, for the costs. */
export type Past = {
  readonly sideCounts: (entry: Id) => readonly [number, number];
  readonly lastSide: (entry: Id) => 0 | 1 | null;
  readonly meetings: (a: Id, b: Id) => number;
  readonly positionCounts: (entry: Id) => readonly number[];
  readonly byes: (entry: Id) => number;
};

const pairKey = (a: Id, b: Id) =>
  compareBytes(a, b) < 0 ? `${a}\u0000${b}` : `${b}\u0000${a}`;

export const pastOf = (
  fixtures: readonly PastFixture[],
  tabRound: number,
): Past => {
  const sides = new Map<Id, [number, number]>();
  const last = new Map<Id, { readonly round: number; readonly side: 0 | 1 }>();
  const met = new Map<string, number>();
  const positions = new Map<Id, number[]>();
  const byes = new Map<Id, number>();
  for (const past of fixtures) {
    if (past.tabRound >= tabRound) continue;
    const fixture = past.fixture;
    if (fixture.kind === 'bye') {
      byes.set(fixture.entry, (byes.get(fixture.entry) ?? 0) + 1);
      continue;
    }
    const held = entriesIn(fixture);
    held.forEach((entry, index) => {
      const counts = positions.get(entry) ?? [];
      while (counts.length <= index) counts.push(0);
      counts[index] = counts[index]! + 1;
      positions.set(entry, counts);
    });
    for (let i = 0; i < held.length; i += 1)
      for (let j = i + 1; j < held.length; j += 1) {
        const key = pairKey(held[i]!, held[j]!);
        met.set(key, (met.get(key) ?? 0) + 1);
      }
    if (fixture.kind === 'pairing' && fixture.sides.length === 2) {
      fixture.sides.forEach((entry, index) => {
        const side = index === 0 ? 0 : 1;
        const counts = sides.get(entry) ?? [0, 0];
        counts[side] += 1;
        sides.set(entry, counts);
        const before = last.get(entry);
        if (before === undefined || before.round <= past.tabRound)
          last.set(entry, { round: past.tabRound, side });
      });
    }
  }
  return {
    sideCounts: (entry) => sides.get(entry) ?? [0, 0],
    lastSide: (entry) => last.get(entry)?.side ?? null,
    meetings: (a, b) => met.get(pairKey(a, b)) ?? 0,
    positionCounts: (entry) => positions.get(entry) ?? [],
    byes: (entry) => byes.get(entry) ?? 0,
  };
};

/**
 * Times each entry sat in an earlier pairing beside an entry with a better
 * record at that time: how often it was pulled up.
 */
export const pullUpCounts = (
  sides: number | null,
  fixtures: readonly PastFixture[],
  reading: ReadonlyMap<Id, Result>,
  settings: ResolvedSettings,
  cutoff: number,
  tabRound: number,
): ((entry: Id) => number) => {
  const pulled = new Map<Id, number>();
  for (const past of fixtures) {
    if (past.tabRound >= tabRound || past.fixture.kind !== 'pairing') continue;
    const records = recordsBefore(
      sides,
      fixtures,
      reading,
      settings,
      cutoff,
      past.tabRound,
    );
    const held = past.fixture.sides;
    const best = Math.max(...held.map(records.of));
    for (const entry of held)
      if (records.of(entry) < best)
        pulled.set(entry, (pulled.get(entry) ?? 0) + 1);
  }
  return (entry) => pulled.get(entry) ?? 0;
};
