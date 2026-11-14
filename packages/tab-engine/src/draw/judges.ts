import type { Fixture, Id } from '../shapes/competition';
import type {
  FixtureRef,
  Judge,
  ShortFixture,
  SlotJudge,
} from '../shapes/draw';
import type { ForceKey, JudgingForceKey } from '../shapes/settings';
import {
  forceOf,
  panelSameSchool,
  seatKeys,
  seatTerms,
  type SeatContext,
  type SeatKey,
} from '../settings/registry';
import { minimumCostAssignment } from '../solve/assignment';
import { maximumFlow } from '../solve/flow';
import { compareVectors, packLexicographic } from '../solve/lexicographic';
import { panelOf, type EventFacts } from './facts';
import { wordFor } from './placement';

export const JUDGES_VERSION = 'judges@1';

/** One fixture to staff: its event's facts, and how many seats its panel has. */
export type StaffTask = {
  readonly facts: EventFacts;
  readonly ref: FixtureRef;
  readonly fixture: Exclude<Fixture, { kind: 'bye' }>;
  readonly size: number;
};

export type Staffing =
  | { readonly kind: 'staffed'; readonly panels: readonly (readonly Id[])[] }
  | {
      readonly kind: 'short';
      readonly panels: readonly (readonly Id[])[];
      readonly short: readonly ShortFixture[];
      readonly removed: readonly {
        readonly key: ForceKey;
        readonly judges: number;
      }[];
      readonly committed: number;
    };

type Seat = { readonly task: number; readonly seat: number };

const seatContext = (
  task: StaffTask,
  seat: number,
  judge: Judge | SlotJudge,
  leastLoad: number,
): SeatContext => ({
  facts: task.facts,
  fixture: task.fixture,
  seat,
  judge,
  leastLoad,
});

/** The rule keys that keep this judge off this seat. */
const blockingRules = (
  task: StaffTask,
  seat: number,
  judge: Judge | SlotJudge,
  leastLoad: number,
) =>
  seatKeys.filter(
    (key) =>
      forceOf(task.facts.settings, key) === 'rule' &&
      seatTerms[key](seatContext(task, seat, judge, leastLoad)) > 0,
  );

/** The weighed seat keys of an event, in `judging.preference_order`. */
const weighed = (facts: EventFacts): SeatKey[] => {
  const order = facts.settings['judging.preference_order'].order;
  return [...order, ...seatKeys.filter((k) => !order.includes(k))].filter(
    (key): key is SeatKey =>
      key !== 'judging.panel_same_school' &&
      forceOf(facts.settings, key) === 'preference',
  );
};

/**
 * Seats panels for every fixture in the call at once. Whether every seat can
 * be filled is decided exactly by maximum flow; the seats are then filled by
 * one exact minimum-cost assignment over the per-seat terms. Only the
 * panel-level term (two judges of one school) is improved by swaps, and only
 * when it is weighed.
 */
export const staff = (input: {
  readonly tasks: readonly StaffTask[];
  readonly judges: readonly (Judge | SlotJudge)[];
  /** People already in a fixture of the slot: committed, or entry members here. */
  readonly occupied: ReadonlySet<Id>;
  readonly committedPeople: ReadonlySet<Id>;
  readonly seed: Uint8Array;
}): Staffing => {
  const { tasks, judges } = input;
  const leastLoad = Math.min(...judges.map((j) => j.tabRoundsJudged), Infinity);
  const seatedAlready = new Set(tasks.flatMap((t) => panelOf(t.fixture)));
  const free = judges.filter(
    (j) => !seatedAlready.has(j.id) && !input.occupied.has(j.person),
  );
  const seats: Seat[] = tasks.flatMap((task, t) =>
    Array.from(
      { length: Math.max(0, task.size - task.fixture.panel.length) },
      (_, k) => ({
        task: t,
        seat: task.fixture.panel.length + k,
      }),
    ),
  );
  const eligible = (seat: Seat, judge: Judge | SlotJudge) => {
    const task = tasks[seat.task]!;
    if (judge.events !== null && !judge.events.includes(task.facts.event))
      return false;
    return blockingRules(task, seat.seat, judge, leastLoad).length === 0;
  };
  const arcs = [
    ...free.map((_, j) => ({ from: 0, to: 2 + j, capacity: 1 })),
    ...seats.flatMap((seat, s) =>
      free.flatMap((judge, j) =>
        eligible(seat, judge)
          ? [{ from: 2 + j, to: 2 + free.length + s, capacity: 1 }]
          : [],
      ),
    ),
    ...seats.map((_, s) => ({ from: 2 + free.length + s, to: 1, capacity: 1 })),
  ];
  const flow = maximumFlow(
    { nodes: 2 + free.length + seats.length, arcs },
    0,
    1,
  );
  const panels = tasks.map((t) => [...t.fixture.panel]);
  if (flow.value < seats.length) {
    arcs.forEach((arc, k) => {
      if (flow.flow[k] === 1 && arc.from >= 2 && arc.to >= 2 + free.length) {
        const seat = seats[arc.to - 2 - free.length]!;
        panels[seat.task]![seat.seat] = free[arc.from - 2]!.id;
      }
    });
    return {
      kind: 'short',
      panels: panels.map((p) => p.filter(Boolean)),
      ...shortReport(input, seats, panels, leastLoad),
    };
  }
  const columns = free.filter((judge) =>
    seats.some((seat) => eligible(seat, judge)),
  );
  const vectors = seats.flatMap((seat) => {
    const task = tasks[seat.task]!;
    return columns.map((judge) =>
      eligible(seat, judge)
        ? [
            ...weighed(task.facts).map((key) =>
              seatTerms[key](seatContext(task, seat.seat, judge, leastLoad)),
            ),
            wordFor(
              input.seed,
              'judges',
              'judges',
              `${judge.id}/${task.facts.event}/${seat.task}`,
            ) >>> 16,
          ]
        : null,
    );
  });
  const width = Math.max(0, ...vectors.map((v) => v?.length ?? 0));
  const padded = vectors.map((v) =>
    v === null
      ? null
      : [
          ...v.slice(0, -1),
          ...Array(width - v.length).fill(0),
          v[v.length - 1]!,
        ],
  );
  const packed = packLexicographic(
    padded.filter((v): v is number[] => v !== null),
    seats.length,
  );
  let at = 0;
  const table = seats.map((_, s) =>
    columns.map((__, j) =>
      padded[s * columns.length + j] === null ? null : packed[at++]!,
    ),
  );
  const assigned = minimumCostAssignment(table)!;
  assigned.forEach((column, s) => {
    const seat = seats[s]!;
    panels[seat.task]![seat.seat] = columns[column]!.id;
  });
  return {
    kind: 'staffed',
    panels: improvePanels(input, tasks, seats, panels, eligible, columns),
  };
};

/** Swaps that lower two-judges-of-one-school without breaking a rule. Heuristic. */
const improvePanels = (
  input: { readonly judges: readonly (Judge | SlotJudge)[] },
  tasks: readonly StaffTask[],
  seats: readonly Seat[],
  panels: Id[][],
  eligible: (seat: Seat, judge: Judge | SlotJudge) => boolean,
  columns: readonly (Judge | SlotJudge)[],
) => {
  const weighs = tasks.some(
    (t) =>
      t.size > 1 &&
      forceOf(t.facts.settings, 'judging.panel_same_school') === 'preference',
  );
  if (!weighs) return panels;
  const byId = new Map(input.judges.map((j) => [j.id, j]));
  const clash = (t: number) =>
    forceOf(tasks[t]!.facts.settings, 'judging.panel_same_school') ===
    'preference'
      ? panelSameSchool({ ...tasks[t]!.fixture, panel: panels[t]! }, byId)
      : 0;
  for (let round = 0, improved = true; improved && round < 20; round += 1) {
    improved = false;
    for (let a = 0; a < seats.length; a += 1)
      for (let b = a + 1; b < seats.length; b += 1) {
        const [x, y] = [seats[a]!, seats[b]!];
        if (x.task === y.task) continue;
        const jx = byId.get(panels[x.task]![x.seat]!)!;
        const jy = byId.get(panels[y.task]![y.seat]!)!;
        if (
          !columns.includes(jx) ||
          !columns.includes(jy) ||
          !eligible(x, jy) ||
          !eligible(y, jx)
        )
          continue;
        const before = clash(x.task) + clash(y.task);
        panels[x.task]![x.seat] = jy.id;
        panels[y.task]![y.seat] = jx.id;
        if (compareVectors([clash(x.task) + clash(y.task)], [before]) < 0)
          improved = true;
        else {
          panels[x.task]![x.seat] = jx.id;
          panels[y.task]![y.seat] = jy.id;
        }
      }
  }
  return panels;
};

/** Which fixtures are short, who could have covered them, and what held each judge back. */
const shortReport = (
  input: Parameters<typeof staff>[0],
  seats: readonly Seat[],
  panels: readonly (readonly (Id | undefined)[])[],
  leastLoad: number,
) => {
  const removed = new Map<JudgingForceKey, Set<Id>>();
  const short: ShortFixture[] = [];
  input.tasks.forEach((task, t) => {
    const empty = seats.filter(
      (s) => s.task === t && panels[t]![s.seat] === undefined,
    );
    if (empty.length === 0) return;
    const could = new Set<Id>();
    for (const judge of input.judges) {
      if (judge.events !== null && !judge.events.includes(task.facts.event))
        continue;
      const rules = empty.flatMap((s) =>
        blockingRules(task, s.seat, judge, leastLoad),
      );
      for (const key of rules)
        removed.set(key, new Set([...(removed.get(key) ?? []), judge.id]));
      if (rules.length > 0 || input.committedPeople.has(judge.person))
        could.add(judge.id);
    }
    short.push({
      event: task.facts.event,
      fixture: task.ref,
      missing: empty.length,
      couldCover: [...could].sort(),
    });
  });
  return {
    short,
    removed: [...removed]
      .map(([key, held]) => ({ key, judges: held.size }))
      .sort((a, b) => (a.key < b.key ? -1 : 1)),
    committed: input.judges.filter((j) => input.committedPeople.has(j.person))
      .length,
  };
};
