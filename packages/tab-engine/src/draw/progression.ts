import type {
  Bye,
  Fixture,
  FormatDescriptor,
  HistoricFixture,
  Id,
  ResultOf,
  StageHistory,
} from '../shapes/competition';
import type { EventRequest } from '../shapes/draw';
import { bracketFirstRound } from '../breaks/bracket';
import { effectiveResults } from '../standings/effective-results';
import { entriesOf } from './facts';
import { roomsFor } from './sections';

export const PROGRESSION_VERSION = 'bracket-progression@1';

/** Who goes on from one fixture of an elimination tab round, by its result. */
const advancing = (
  fixture: Fixture,
  result: ResultOf<FormatDescriptor> | undefined,
): readonly Id[] | null => {
  if (fixture.kind === 'bye') return [fixture.entry];
  if (result === undefined) return null;
  const outcome = result.outcome;
  if (outcome.kind === 'winner')
    return outcome.winner === null ? [] : [outcome.winner];
  const keep =
    fixture.kind === 'pairing' ? 2 : Math.ceil(fixture.speakers.length / 2);
  return [...outcome.places]
    .sort((a, b) => a.place - b.place)
    .slice(0, keep)
    .map((p) => p.entry);
};

const sameEntries = (a: Fixture, b: Fixture) =>
  a.kind === b.kind &&
  [...entriesOf(a)].sort().join() === [...entriesOf(b)].sort().join();

/** Seeds dealt into k rooms by snake: 1..k, then k..1, and so on. */
const snake = <T>(items: readonly T[], rooms: number): T[][] => {
  const out: T[][] = Array.from({ length: rooms }, () => []);
  items.forEach((item, i) => {
    const row = Math.floor(i / rooms);
    const col = i % rooms;
    out[row % 2 === 0 ? col : rooms - 1 - col]!.push(item);
  });
  return out;
};

type Slots = readonly (readonly Id[])[];

/** The fixtures of one elimination tab round, for the slots it fills. */
const fixturesFor = (
  request: EventRequest,
  slots: Slots,
  seedOf: (e: Id) => number,
): Fixture[] =>
  slots.flatMap((slot): Fixture[] => {
    const ordered = [...slot].sort((a, b) => seedOf(a) - seedOf(b));
    if (ordered.length === 0) return [];
    if (ordered.length === 1)
      return [{ kind: 'bye', entry: ordered[0]! } satisfies Bye];
    switch (request.format.outcome) {
      case 'winner':
        return [
          { kind: 'pairing', sides: [ordered[0]!, ordered[1]!], panel: [] },
        ];
      case 'ranking':
        return 'sides' in request.format
          ? [
              {
                kind: 'pairing',
                sides: [ordered[0]!, ordered[1]!, ordered[2]!, ordered[3]!],
                panel: [],
              },
            ]
          : [{ kind: 'section', speakers: ordered, panel: [] }];
    }
  });

/** The rooms of a tab round from the entries going on, best seed first. */
const roomsOf = (request: EventRequest, going: readonly Id[]): Slots => {
  const format = request.format;
  if (format.outcome === 'winner')
    return bracketFirstRound(going.length).map(([a, b]) =>
      b === null ? [going[a]!] : [going[a]!, going[b]!],
    );
  const size =
    'sides' in format ? 4 : request.settings['pairing.section_size'].target;
  const byes = 'sides' in format ? going.length % 4 : 0;
  const rest = going.slice(byes);
  const rooms = roomsFor(rest.length, size);
  return [...going.slice(0, byes).map((e) => [e]), ...snake(rest, rooms)];
};

/**
 * Bracket progression: the next tab round's fixtures are a pure function of
 * the bracket and the results so far. Two sides follow the standard seeded
 * tree, winners meeting in bracket order; ranked formats send the top of
 * each room on and deal them again by seed.
 */
export const progression = (
  request: EventRequest,
  seeds: readonly Id[],
):
  | { readonly kind: 'fixtures'; readonly fixtures: Fixture[] }
  | { readonly kind: 'missing'; readonly fixture: Id } => {
  const seedOf = (entry: Id) => seeds.indexOf(entry);
  const history = request.history as StageHistory<FormatDescriptor>;
  const results = new Map(
    effectiveResults(history, Infinity).map((r) => [r.fixture, r]),
  );
  let slots = roomsOf(request, seeds);
  for (let round = 1; round < request.tabRound; round += 1) {
    const played = history.fixtures.filter((f) => f.tabRound === round);
    /**
     * What each slot sends on, in bracket order. A slot keeps its place even
     * when nobody goes on (a double loss), so the next tab round pairs the
     * same bracket positions and the survivor of the pair takes a bye.
     */
    const going: (readonly Id[])[] = [];
    for (const slot of slots) {
      const fixture = fixturesFor(request, [slot], seedOf)[0];
      if (fixture === undefined) {
        going.push([]);
        continue;
      }
      const record: HistoricFixture<FormatDescriptor> | undefined = played.find(
        (f) => sameEntries(f.fixture, fixture),
      );
      const on = advancing(
        fixture,
        record === undefined ? undefined : results.get(record.id),
      );
      if (on === null) return { kind: 'missing', fixture: record?.id ?? '' };
      going.push(on);
    }
    slots =
      request.format.outcome === 'winner'
        ? Array.from({ length: Math.ceil(going.length / 2) }, (_, i) => [
            ...going[2 * i]!,
            ...(going[2 * i + 1] ?? []),
          ])
        : roomsOf(
            request,
            going.flat().sort((a, b) => seedOf(a) - seedOf(b)),
          );
  }
  return { kind: 'fixtures', fixtures: fixturesFor(request, slots, seedOf) };
};
