import type { Fixture, Id } from '../shapes/competition';
import type {
  DrawInput,
  ExistingFixture,
  Judge,
  SlotJudge,
} from '../shapes/draw';
import { forceKeys, type JudgingForceKey } from '../shapes/settings';
import { costContext, placedOf } from './context';
import { forceOf, seatCosts } from './costs';
import { entriesIn } from './past';
import type { Matched } from './structure';

type Edge = { readonly to: number; cap: number; readonly back: number };

/** The most that can flow from `source` to `sink`, by augmenting paths. */
export const maxFlow = (
  nodes: number,
  arcs: readonly (readonly [number, number, number])[],
  source: number,
  sink: number,
): number => {
  const graph: Edge[][] = Array.from({ length: nodes }, () => []);
  for (const [from, to, cap] of arcs) {
    graph[from]!.push({ to, cap, back: graph[to]!.length });
    graph[to]!.push({ to: from, cap: 0, back: graph[from]!.length - 1 });
  }
  const push = (at: number, amount: number, seen: boolean[]): number => {
    if (at === sink) return amount;
    seen[at] = true;
    for (const edge of graph[at]!) {
      if (edge.cap <= 0 || seen[edge.to]) continue;
      const sent = push(edge.to, Math.min(amount, edge.cap), seen);
      if (sent > 0) {
        edge.cap -= sent;
        graph[edge.to]![edge.back]!.cap += sent;
        return sent;
      }
    }
    return 0;
  };
  let flow = 0;
  for (;;) {
    const sent = push(source, Infinity, Array(nodes).fill(false));
    if (sent === 0) return flow;
    flow += sent;
  }
};

const judgingRules = (matched: Matched) =>
  (Object.keys(forceKeys) as JudgingForceKey[]).filter(
    (key) =>
      key.startsWith('judging.') && forceOf(matched.request, key) === 'rule',
  );

/**
 * The open seats of a call's fixtures, and how many of them the judges could
 * fill at once. A judge may sit in a seat of an event they may judge, where
 * every judging rule of that event costs nothing, on a fixture not holding
 * their own entry; in a slot, not when a commitment or a fixture of the call
 * holds them as a competitor; and not when already seated on a kept fixture.
 * Seat 0 (the chair) is told apart from the others, which cost alike.
 */
export const panelCapacity = (
  input: DrawInput,
  matched: readonly Matched[],
): { readonly open: number; readonly fillable: number } => {
  const judges: readonly (Judge | SlotJudge)[] = input.judges ?? [];
  const occupied = new Set<Id>(
    input.call === 'slot' ? input.commitments.flatMap((c) => c.people) : [],
  );
  const taken = new Set<Id>();
  const groups: {
    readonly m: Matched;
    readonly fixture: Fixture;
    readonly seat: number;
    readonly cap: number;
  }[] = [];
  for (const m of matched) {
    const members = new Map(m.request.entries.map((e) => [e.id, e.members]));
    const existing = new Map(
      (m.request.existing as readonly ExistingFixture<never>[]).map((e) => [
        e.id,
        e.fixture as Fixture,
      ]),
    );
    const size = m.request.settings['judging.panel'][m.request.stage.kind].size;
    for (const { ref, fixture } of placedOf(m.plan)) {
      if (fixture.kind === 'bye') continue;
      if (input.call === 'slot')
        for (const entry of entriesIn(fixture))
          for (const person of members.get(entry) ?? []) occupied.add(person);
      const before = ref.kind === 'existing' ? existing.get(ref.id) : undefined;
      const seated =
        before === undefined || before.kind === 'bye' ? [] : before.panel;
      for (const id of seated) taken.add(id);
      const open = Math.max(0, size - seated.length);
      if (open === 0) continue;
      const chairOpen = seated.length === 0;
      if (chairOpen) groups.push({ m, fixture, seat: 0, cap: 1 });
      if (open - (chairOpen ? 1 : 0) > 0)
        groups.push({ m, fixture, seat: 1, cap: open - (chairOpen ? 1 : 0) });
    }
  }
  const contexts = new Map(
    matched.map((m) => [m.request.event, costContext(input, m.request)]),
  );
  const source = 0;
  const sink = 1 + judges.length + groups.length;
  const arcs: [number, number, number][] = [];
  judges.forEach((judge, j) => {
    if (taken.has(judge.id) || occupied.has(judge.person)) return;
    arcs.push([source, 1 + j, 1]);
    groups.forEach((g, i) => {
      const event = g.m.request.event;
      if (judge.events !== null && !judge.events.includes(event)) return;
      const held = entriesIn(g.fixture);
      const members = new Set(
        g.m.request.entries
          .filter((e) => held.includes(e.id))
          .flatMap((e) => e.members),
      );
      if (members.has(judge.person)) return;
      const costs = seatCosts(contexts.get(event)!, held, judge, g.seat);
      if (judgingRules(g.m).some((key) => (costs.get(key) ?? 0) > 0)) return;
      arcs.push([1 + j, 1 + judges.length + i, 1]);
    });
  });
  groups.forEach((g, i) => arcs.push([1 + judges.length + i, sink, g.cap]));
  const open = groups.reduce((sum, g) => sum + g.cap, 0);
  return { open, fillable: maxFlow(sink + 1, arcs, source, sink) };
};
