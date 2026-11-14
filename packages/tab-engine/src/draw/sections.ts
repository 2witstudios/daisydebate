import type { Id, Section, Speakers } from '../shapes/competition';
import type { RequestOf } from '../shapes/draw';
import { forceOf, pairingTerms } from '../settings/registry';
import { minimumCostAssignment } from '../solve/assignment';
import { compareVectors, packLexicographic } from '../solve/lexicographic';
import { entriesOf, type EventFacts } from './facts';
import {
  brokenRules,
  poolOf,
  wordFor,
  type PlacementAnswer,
} from './placement';

export const SECTIONS_VERSION = 'sections@1';

/** Section sizes for a field: as close to the target as possible, differing by at most one. */
export const sectionSizes = (count: number, target: number): number[] => {
  if (count === 0) return [];
  const sections = Math.max(1, Math.round(count / target));
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

/** Rule breaks, then the weighed school and meeting costs, of one section. */
const sectionCost = (facts: EventFacts, members: readonly Id[]) => {
  const fixture = sectionOf(members);
  const weigh = (key: 'pairing.same_school' | 'pairing.section_repeat') =>
    forceOf(facts.settings, key) === 'preference'
      ? (pairingTerms[key](facts, fixture)?.[0] ?? 0)
      : 0;
  return [
    brokenRules(facts, fixture).length,
    weigh('pairing.same_school'),
    weigh('pairing.section_repeat'),
  ];
};

/** Steepest descent over single swaps between sections, until no swap improves. */
const improve = (facts: EventFacts, sections: Id[][]) => {
  const cost = (members: readonly Id[]) => sectionCost(facts, members);
  for (let rounds = 0; rounds < 200; rounds += 1) {
    let best: {
      i: number;
      j: number;
      a: number;
      b: number;
      gain: number[];
    } | null = null;
    for (let i = 0; i < sections.length; i += 1)
      for (let j = i + 1; j < sections.length; j += 1) {
        const before = cost(sections[i]!).map(
          (v, k) => v + cost(sections[j]!)[k]!,
        );
        sections[i]!.forEach((x, a) =>
          sections[j]!.forEach((y, b) => {
            const left = sections[i]!.map((e, k) => (k === a ? y : e));
            const right = sections[j]!.map((e, k) => (k === b ? x : e));
            const after = cost(left).map((v, k) => v + cost(right)[k]!);
            const gain = before.map((v, k) => v - after[k]!);
            if (
              compareVectors(
                gain,
                gain.map(() => 0),
              ) > 0 &&
              (best === null || compareVectors(gain, best.gain) > 0)
            )
              best = { i, j, a, b, gain };
          }),
        );
      }
    if (best === null) break;
    const { i, j, a, b } = best;
    [sections[i]![a], sections[j]![b]] = [sections[j]![b]!, sections[i]![a]!];
  }
  return sections;
};

/** Speaker order: one exact assignment of speakers to places against each one's place history. */
export const speakerOrder = (
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
  )!;
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
): PlacementAnswer => {
  const movable = request.existing.filter((f) => f.hold === 'movable');
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
  if (
    forceOf(facts.settings, 'pairing.same_school') === 'rule' &&
    [...schoolCounts(facts, open).values()].some(
      (count) => count > remaining.length,
    )
  )
    return { kind: 'infeasible' };
  const sections =
    remaining.length === 0 ? [] : improve(facts, deal(facts, open, remaining));
  const added = sections.map((members) =>
    sectionOf(speakerOrder(facts, seed, members)),
  );
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
