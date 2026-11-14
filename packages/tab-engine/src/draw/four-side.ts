import { shuffleWith } from '@daisy/seeded-random';
import type { Bye, FourSidePairing, FourSides, Id } from '../shapes/competition';
import type { RequestOf } from '../shapes/draw';
import { forceOf, pairingTerms } from '../settings/registry';
import { minimumCostAssignment } from '../solve/assignment';
import { compareVectors, packLexicographic } from '../solve/lexicographic';
import { entriesOf, type EventFacts } from './facts';
import { byStrength, byeTakers } from './order';
import { brokenRules, eventStream, poolOf, wordFor, type PlacementAnswer } from './placement';

export const FOUR_SIDE_VERSION = 'pairing-four-side@1';

type Room = readonly [Id, Id, Id, Id];

/** Twice the extra times a team would hold position p over its least-held one. */
const positionCost = (facts: EventFacts, team: Id, position: number) => {
  const counts = facts.positions.get(team) ?? [];
  const held = (i: number) => counts[i] ?? 0;
  return 2 * (held(position) - Math.min(held(0), held(1), held(2), held(3)));
};

/**
 * Pools of equal points, from the top. A pool that does not fill its rooms
 * takes pull-ups from the pool below: the least pulled before (or the
 * weakest, by `pairing.pull_up`), then a seeded choice.
 */
const pools = (facts: EventFacts, seed: Uint8Array, entries: readonly Id[]): Id[][] => {
  const byRecord = new Map<number, Id[]>();
  for (const e of entries) byRecord.set(facts.record.get(e) ?? 0, [...(byRecord.get(facts.record.get(e) ?? 0) ?? []), e]);
  const levels = [...byRecord].sort(([a], [b]) => b - a).map(([, members]) => byStrength(facts, members));
  const out: Id[][] = [];
  let carry: Id[] = [];
  levels.forEach((level, i) => {
    const members = [...carry, ...level];
    const short = (4 - (members.length % 4)) % 4;
    const below = levels[i + 1];
    if (short === 0 || below === undefined) {
      out.push(members);
      carry = [];
      return;
    }
    if (below.length <= short) {
      carry = members;
      return;
    }
    const lot = (e: Id) => wordFor(seed, facts.event, 'pairing/pull_up', e);
    const choose = facts.settings['pairing.pull_up'].choose;
    const candidates = [...below].sort(
      (a, b) =>
        (choose === 'least_pulled'
          ? (facts.pulledUp.get(a) ?? 0) - (facts.pulledUp.get(b) ?? 0)
          : (facts.weakerInGroup.get(a) ?? 0) - (facts.weakerInGroup.get(b) ?? 0)) || lot(a) - lot(b),
    );
    const pulled = candidates.slice(0, short);
    out.push([...members, ...pulled]);
    levels[i + 1] = below.filter((e) => !pulled.includes(e));
    carry = [];
  });
  return out.filter((pool) => pool.length > 0);
};

/**
 * Positions within a pool are one exact assignment: each team's cost depends
 * only on its position, so the sum of squared position counts is minimised
 * with each position used equally. Rooms are then formed by a seeded shuffle,
 * one team per position.
 */
const roomsOfPool = (facts: EventFacts, seed: Uint8Array, pool: readonly Id[], index: number): Room[] => {
  const rooms = pool.length / 4;
  const weighed = forceOf(facts.settings, 'pairing.position_balance') === 'preference';
  const slots = Array.from({ length: pool.length }, (_, s) => s % 4);
  const vectors = pool.flatMap((team) =>
    slots.map((position) => [
      weighed ? positionCost(facts, team, position) : 0,
      wordFor(seed, facts.event, 'pairing/positions', `${team}/${position}`) >>> 20,
    ]),
  );
  const packed = packLexicographic(vectors, pool.length);
  const assigned = minimumCostAssignment(pool.map((_, t) => slots.map((__, s) => packed[t * slots.length + s]!)))!;
  const byPosition = [0, 1, 2, 3].map((position) =>
    shuffleWith(
      pool.filter((_, t) => slots[assigned[t]!] === position),
      eventStream(seed, facts.event, `pairing/rooms/${index}/${position}`),
    ),
  );
  return Array.from({ length: rooms }, (_, r) => [
    byPosition[0]![r]!,
    byPosition[1]![r]!,
    byPosition[2]![r]!,
    byPosition[3]![r]!,
  ]);
};

const roomFixture = (room: Room): FourSidePairing => ({ kind: 'pairing', sides: room, panel: [] });

/** Rule breaks first, then the weighed school and meeting costs. */
const groupingCost = (facts: EventFacts, room: Room) => {
  const fixture = roomFixture(room);
  const weigh = (key: 'pairing.same_school' | 'pairing.rematch') =>
    forceOf(facts.settings, key) === 'preference' ? (pairingTerms[key](facts, fixture)?.[0] ?? 0) : 0;
  return [brokenRules(facts, fixture).length, weigh('pairing.same_school'), weigh('pairing.rematch')];
};

/**
 * Where school or meetings are weighed or ruled, a deterministic swap search
 * exchanges teams of one pool and one position between rooms while that
 * lowers the cost. Heuristic, and it says so: a rule still broken after it is
 * `unresolved`.
 */
const improve = (facts: EventFacts, rooms: Room[], poolOfRoom: readonly number[]) => {
  const total = (a: Room, b: Room) => {
    const [x, y] = [groupingCost(facts, a), groupingCost(facts, b)];
    return x.map((v, i) => v + y[i]!);
  };
  for (let improved = true, rounds = 0; improved && rounds < 50; rounds += 1) {
    improved = false;
    for (let i = 0; i < rooms.length; i += 1)
      for (let j = i + 1; j < rooms.length; j += 1) {
        if (poolOfRoom[i] !== poolOfRoom[j]) continue;
        for (let p = 0; p < 4; p += 1) {
          const a = [...rooms[i]!] as [Id, Id, Id, Id];
          const b = [...rooms[j]!] as [Id, Id, Id, Id];
          [a[p], b[p]] = [b[p]!, a[p]!];
          if (compareVectors(total(a, b), total(rooms[i]!, rooms[j]!)) < 0) {
            rooms[i] = a;
            rooms[j] = b;
            improved = true;
          }
        }
      }
  }
  return rooms;
};

export const placeFourSide = (request: RequestOf<FourSides>, facts: EventFacts, seed: Uint8Array): PlacementAnswer => {
  const movable = request.existing.filter((f) => f.hold === 'movable');
  const pool = poolOf(request, entriesOf);
  const keptMovable = movable.filter(
    (f) => brokenRules(facts, f.fixture).length === 0 && entriesOf(f.fixture).every((e) => pool.includes(e)),
  );
  const held = new Set(keptMovable.flatMap((f) => entriesOf(f.fixture)));
  const open = pool.filter((e) => !held.has(e));
  const byes: Bye[] = byeTakers(facts, seed, open, open.length % 4).map((entry) => ({ kind: 'bye', entry }));
  const placing = open.filter((e) => !byes.some((b) => b.entry === e));
  const grouped = facts.powered ? pools(facts, seed, placing) : [byStrength(facts, placing)];
  const rooms: Room[] = [];
  const poolOfRoom: number[] = [];
  grouped.forEach((members, index) => {
    for (const room of roomsOfPool(facts, seed, members, index)) {
      rooms.push(room);
      poolOfRoom.push(index);
    }
  });
  const weighsGrouping = (['pairing.same_school', 'pairing.rematch'] as const).some(
    (key) => forceOf(facts.settings, key) !== 'off' && forceOf(facts.settings, key) !== 'warning',
  );
  const final = weighsGrouping ? improve(facts, rooms, poolOfRoom) : rooms;
  const added = [...final.map(roomFixture), ...byes];
  const placed = {
    kept: request.existing
      .filter((f) => f.hold === 'fixed' || keptMovable.includes(f))
      .map((f) => ({ id: f.id, fixture: f.fixture })),
    added,
    withdrawn: movable.filter((f) => !keptMovable.includes(f)).map((f) => f.id),
  };
  return added.some((fixture) => brokenRules(facts, fixture).length > 0)
    ? { kind: 'unresolved', placed }
    : { kind: 'placed', placed };
};
