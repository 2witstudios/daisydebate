import type { Id, Section, Speakers } from '../shapes/competition';
import type { RequestOf } from '../shapes/draw';
import { forceOf } from '../settings/registry';
import { minimumCostAssignment } from '../solve/assignment';
import { compareVectors, packLexicographic } from '../solve/lexicographic';
import { entriesOf, pairKey, type EventFacts } from './facts';
import {
  brokenRules,
  poolOf,
  wordFor,
  placedFrom,
  placedOrUnresolved,
  type PlacementAnswer,
} from './placement';

export const SECTIONS_VERSION = 'sections@1';

/** Section sizes for a field: as close to the target as possible, differing by at most one. */
/** How many rooms of about `size` a field makes: the nearest whole number, at least one, in integers. */
export const roomsFor = (count: number, size: number) =>
  Math.max(1, Math.floor((2 * count + size) / (2 * size)));

const sectionSizes = (count: number, target: number): number[] => {
  if (count === 0) return [];
  const sections = roomsFor(count, target);
  const base = Math.floor(count / sections);
  return Array.from(
    { length: sections },
    (_, i) => base + (i < count % sections ? 1 : 0),
  );
};

const schoolOf = (facts: EventFacts, entry: Id) =>
  facts.schools.get(entry)?.[0] ?? `\u0000${entry}`;

/**
 * The deal: schools largest first, each entry to the next section in turn.
 * A school with no more entries than there are sections never shares one,
 * and the sizes differ by at most one.
 */
const deal = (
  facts: EventFacts,
  entries: readonly Id[],
  sizes: readonly number[],
): Id[][] => {
  const bySchool = new Map<string, Id[]>();
  for (const e of entries)
    bySchool.set(schoolOf(facts, e), [
      ...(bySchool.get(schoolOf(facts, e)) ?? []),
      e,
    ]);
  const ordered = [...bySchool]
    .sort(([a, x], [b, y]) => y.length - x.length || (a < b ? -1 : 1))
    .flatMap(([, members]) => members);
  const out: Id[][] = sizes.map(() => []);
  ordered.forEach((entry, i) => out[i % sizes.length]!.push(entry));
  return out;
};

const sectionOf = (speakers: readonly Id[]): Section => ({
  kind: 'section',
  speakers,
  panel: [],
});

/**
 * What two speakers cost by sharing a section, highest field first: a
 * same-school pair under the rule, a same-school pair where it is weighed,
 * and their prior meetings where `pairing.section_repeat` is weighed. Every
 * grouping cost of a section is a sum over its pairs, so a swap is costed by
 * the pairs it changes alone.
 */
const pairCost = (facts: EventFacts) => {
  const sameSchool = forceOf(facts.settings, 'pairing.same_school');
  const repeat =
    forceOf(facts.settings, 'pairing.section_repeat') === 'preference';
  return (x: Id, z: Id): readonly [number, number, number] => {
    const shared = (facts.schools.get(x) ?? []).some((school) =>
      (facts.schools.get(z) ?? []).includes(school),
    )
      ? 1
      : 0;
    return [
      sameSchool === 'rule' ? shared : 0,
      sameSchool === 'preference' ? shared : 0,
      repeat ? (facts.meetings.get(pairKey(x, z)) ?? 0) : 0,
    ];
  };
};

/** Steepest descent over single swaps between sections, until no swap improves. */
const improve = (facts: EventFacts, sections: Id[][]) => {
  const cost = pairCost(facts);
  const everyone = sections.flat();
  const n = everyone.length;
  // Each section by its members' places in `everyone`, where the table reads.
  let place = 0;
  const places = sections.map((section) => section.map(() => place++));
  /** The pair costs, computed once: a swap then reads only the pairs it changes. */
  const table = everyone.flatMap((x) =>
    everyone.map((z) => (x === z ? ([0, 0, 0] as const) : cost(x, z))),
  );
  const pair = (x: number, z: number) => table[x * n + z]!;
  /** The change in cost when x leaves `from` (where y arrives) and joins `to`. */
  const swapDelta = (
    x: number,
    y: number,
    from: readonly number[],
    to: readonly number[],
  ) => {
    const delta = [0, 0, 0];
    for (const z of from) {
      if (z === x) continue;
      const [lose, gain] = [pair(x, z), pair(y, z)];
      for (let k = 0; k < 3; k += 1) delta[k] = delta[k]! + gain[k]! - lose[k]!;
    }
    for (const z of to) {
      if (z === y) continue;
      const [lose, gain] = [pair(y, z), pair(x, z)];
      for (let k = 0; k < 3; k += 1) delta[k] = delta[k]! + gain[k]! - lose[k]!;
    }
    return delta;
  };
  for (let rounds = 0; rounds < 200; rounds += 1) {
    // The callbacks below improve it; a holder keeps its type visible to them.
    const search: {
      best: {
        i: number;
        j: number;
        a: number;
        b: number;
        delta: number[];
      } | null;
    } = { best: null };
    for (let i = 0; i < places.length; i += 1)
      for (let j = i + 1; j < places.length; j += 1)
        places[i]!.forEach((x, a) =>
          places[j]!.forEach((y, b) => {
            const delta = swapDelta(x, y, places[i]!, places[j]!);
            if (
              compareVectors(delta, [0, 0, 0]) < 0 &&
              (search.best === null ||
                compareVectors(delta, search.best.delta) < 0)
            )
              search.best = { i, j, a, b, delta };
          }),
        );
    if (search.best === null) break;
    const { i, j, a, b } = search.best;
    [sections[i]![a], sections[j]![b]] = [sections[j]![b]!, sections[i]![a]!];
    [places[i]![a], places[j]![b]] = [places[j]![b]!, places[i]![a]!];
  }
  return sections;
};

/** Speaker order: one exact assignment of speakers to places against each one's place history. */
const speakerOrder = (
  facts: EventFacts,
  seed: Uint8Array,
  members: readonly Id[],
): Id[] => {
  const weighed =
    forceOf(facts.settings, 'pairing.position_balance') === 'preference';
  const vectors = members.flatMap((speaker) =>
    members.map((_, place) => {
      const counts = facts.positions.get(speaker) ?? [];
      const least = Math.min(...members.map((__, i) => counts[i] ?? 0));
      return [
        weighed ? 2 * ((counts[place] ?? 0) - least) : 0,
        wordFor(seed, facts.event, 'sections/order', `${speaker}/${place}`) >>>
          20,
      ];
    }),
  );
  const packed = packLexicographic(vectors, members.length);
  const assigned = minimumCostAssignment(
    members.map((_, s) =>
      members.map((__, p) => packed[s * members.length + p]!),
    ),
  );
  // As many places as speakers: a square matrix always has an assignment.
  if (assigned === null) throw new Error('Every speaker has a place');
  const order: Id[] = Array.from({ length: members.length });
  assigned.forEach((place, s) => (order[place] = members[s]!));
  return order;
};

const schoolCounts = (facts: EventFacts, entries: readonly Id[]) => {
  const counts = new Map<string, number>();
  for (const e of entries) {
    const school = facts.schools.get(e)?.[0];
    if (school !== undefined) counts.set(school, (counts.get(school) ?? 0) + 1);
  }
  return counts;
};

/**
 * Sectioning: a constructive deal, then deterministic local search.
 * Partitioning with pairwise costs is NP-hard, so this is heuristic and may
 * answer `unresolved`; the same-school rule alone is exact, by counting: it
 * is infeasible exactly when one school has more entries than there are
 * sections.
 */
export const placeSections = (
  request: RequestOf<Speakers>,
  facts: EventFacts,
  seed: Uint8Array,
  released: ReadonlySet<Id> = new Set(),
): PlacementAnswer => {
  const movable = request.existing.filter(
    (f) => f.hold === 'movable' && !released.has(f.id),
  );
  const pool = poolOf(request, entriesOf);
  const target = request.settings['pairing.section_size'].target;
  const sizes = sectionSizes(pool.length, target);
  const remaining = [...sizes];
  const keptMovable = movable.filter((f) => {
    if (
      f.fixture.kind !== 'section' ||
      brokenRules(facts, f.fixture).length > 0
    )
      return false;
    if (!f.fixture.speakers.every((e) => pool.includes(e))) return false;
    const at = remaining.indexOf(f.fixture.speakers.length);
    if (at === -1) return false;
    remaining.splice(at, 1);
    return true;
  });
  const held = new Set(keptMovable.flatMap((f) => entriesOf(f.fixture)));
  const open = pool.filter((e) => !held.has(e));
  const binding = [...schoolCounts(facts, open)]
    .filter(([, count]) => count > remaining.length)
    .map(([school]) => school);
  if (
    forceOf(facts.settings, 'pairing.same_school') === 'rule' &&
    binding.length > 0
  ) {
    /**
     * Keeping a movable section can be what blocks the counting proof.
     * Release one at a time, in canonical order, choosing first a section
     * that holds no entry of a school over the count: it frees a room without
     * adding one of that school's entries to place.
     */
    const holdsBinding = (f: (typeof keptMovable)[number]) =>
      entriesOf(f.fixture).some((e) =>
        binding.includes(facts.schools.get(e)?.[0] ?? ''),
      );
    const next = keptMovable.find((f) => !holdsBinding(f)) ?? keptMovable[0];
    return next === undefined
      ? { kind: 'infeasible' }
      : placeSections(request, facts, seed, new Set([...released, next.id]));
  }
  const sections =
    remaining.length === 0 ? [] : improve(facts, deal(facts, open, remaining));
  const added = sections.map((members) =>
    sectionOf(speakerOrder(facts, seed, members)),
  );
  return placedOrUnresolved(facts, placedFrom(request, keptMovable, added));
};
