import type { Entry, Fixture, Id, ProtectionKey } from '../shapes/competition';
import type { EventRequest, Judge, SlotJudge } from '../shapes/draw';
import type { ForceKey, JudgingForceKey } from '../shapes/settings';
import type { Past, Records } from './past';

/** Everything the costs of one event's fixtures are counted from. */
export type CostContext = {
  readonly request: EventRequest;
  readonly entries: ReadonlyMap<Id, Entry>;
  readonly past: Past;
  /** Null when no pull-up is weighed in this tab round. */
  readonly records: Records | null;
  readonly pulled: (entry: Id) => number;
  readonly judges: ReadonlyMap<Id, Judge | SlotJudge> | null;
  readonly leastLoad: number;
  readonly slot: boolean;
};

const schoolsOf = (protection: readonly ProtectionKey[]) =>
  new Set(protection.filter((p) => p.scope === 'school').map((p) => p.key));

const share = (a: ReadonlySet<string>, b: ReadonlySet<string>) =>
  [...a].some((key) => b.has(key));

const pairs = <T>(items: readonly T[]): readonly (readonly [T, T])[] =>
  items.flatMap((a, i) => items.slice(i + 1).map((b) => [a, b] as const));

const count = (items: readonly Id[], within: readonly Id[]) =>
  items.filter((id) => within.includes(id)).length;

const pairingCosts = (
  ctx: CostContext,
  held: readonly Id[],
  costs: Map<ForceKey, readonly number[]>,
) => {
  const { past, request } = ctx;
  const schools = (entry: Id) =>
    schoolsOf(ctx.entries.get(entry)?.protection ?? []);
  costs.set('pairing.rematch', [
    pairs(held).reduce((sum, [a, b]) => sum + past.meetings(a, b), 0),
  ]);
  costs.set('pairing.same_school', [
    pairs(held).filter(([a, b]) => share(schools(a), schools(b))).length,
  ]);
  if (held.length === 2) {
    const most = request.settings['pairing.side_balance'].maxImbalance;
    costs.set('pairing.side_balance', [
      held.reduce((sum, entry, side) => {
        const [first, second] = past.sideCounts(entry);
        const imbalance =
          first + (side === 0 ? 1 : 0) - (second + (side === 1 ? 1 : 0));
        return sum + Math.max(0, Math.abs(imbalance) - most);
      }, 0),
    ]);
    costs.set('pairing.side_alternation', [
      held.filter((entry, side) => past.lastSide(entry) === side).length,
    ]);
  }
  if (ctx.records !== null) {
    const records = ctx.records;
    const values = held.map(records.of);
    const highest = Math.max(...values);
    costs.set('pairing.pull_up', [
      highest - Math.min(...values),
      held
        .filter((entry) => records.of(entry) < highest)
        .reduce((sum, entry) => sum + ctx.pulled(entry), 0),
    ]);
  }
};

const positionBalance = (past: Past, held: readonly Id[]) =>
  held.reduce((sum, entry, position) => {
    const counts = past.positionCounts(entry);
    const fewest = Math.min(...held.map((_, q) => counts[q] ?? 0));
    return sum + 2 * ((counts[position] ?? 0) - fewest);
  }, 0);

/** What seating one judge in one seat of a fixture holding `held` costs, per judging key. */
export const seatCosts = (
  ctx: CostContext,
  held: readonly Id[],
  judge: Judge | SlotJudge,
  seat: number,
): ReadonlyMap<JudgingForceKey, number> => {
  const mine = schoolsOf(judge.protection);
  const entrySchools = held.map((entry) =>
    schoolsOf(ctx.entries.get(entry)?.protection ?? []),
  );
  return new Map<JudgingForceKey, number>([
    [
      'judging.availability',
      ctx.slot && 'available' in judge && !judge.available ? 1 : 0,
    ],
    ['judging.strike', count(held, judge.strikes)],
    ['judging.conflict', count(held, judge.conflicts)],
    [
      'judging.same_school',
      entrySchools.filter((schools) => share(schools, mine)).length,
    ],
    ['judging.repeat_judge', count(held, judge.judged)],
    ['judging.unsubmitted_ballot', judge.outstandingBallots > 0 ? 1 : 0],
    ['judging.load_balance', judge.tabRoundsJudged - ctx.leastLoad],
    ['judging.chair', seat === 0 && !judge.chair ? 1 : 0],
  ]);
};

const judgingCosts = (
  ctx: CostContext,
  held: readonly Id[],
  panel: readonly Id[],
  costs: Map<ForceKey, readonly number[]>,
) => {
  const judges = ctx.judges;
  if (judges === null) return;
  const seated = panel.flatMap((id, seat) => {
    const judge = judges.get(id);
    return judge === undefined ? [] : [{ judge, seat }];
  });
  for (const { judge, seat } of seated)
    for (const [key, cost] of seatCosts(ctx, held, judge, seat))
      costs.set(key, [(costs.get(key)?.[0] ?? 0) + cost]);
  if (seated.length === 0)
    for (const key of seatCosts(ctx, held, nobody, 1).keys())
      costs.set(key, [0]);
  costs.set('judging.panel_same_school', [
    pairs(seated.map(({ judge }) => schoolsOf(judge.protection))).filter(
      ([a, b]) => share(a, b),
    ).length,
  ]);
};

/** A judge used only to list the judging keys of an empty panel. */
const nobody: Judge = {
  id: '',
  person: '',
  protection: [],
  events: null,
  conflicts: [],
  strikes: [],
  judged: [],
  tabRoundsJudged: 0,
  outstandingBallots: 0,
  chair: true,
};

/** Each applicable force key's count for one fixture: zero kept, above zero broken. */
const everyCost = (
  ctx: CostContext,
  fixture: Fixture,
): ReadonlyMap<ForceKey, readonly number[]> => {
  const costs = new Map<ForceKey, readonly number[]>();
  switch (fixture.kind) {
    case 'bye':
      costs.set('bye.repeat', [ctx.past.byes(fixture.entry)]);
      return costs;
    case 'pairing':
      pairingCosts(ctx, fixture.sides, costs);
      if (fixture.sides.length === 4)
        costs.set('pairing.position_balance', [
          positionBalance(ctx.past, fixture.sides),
        ]);
      judgingCosts(ctx, fixture.sides, fixture.panel, costs);
      return costs;
    case 'section': {
      const held = fixture.speakers;
      const schools = (entry: Id) =>
        schoolsOf(ctx.entries.get(entry)?.protection ?? []);
      costs.set('pairing.same_school', [
        pairs(held).filter(([a, b]) => share(schools(a), schools(b))).length,
      ]);
      costs.set('pairing.position_balance', [positionBalance(ctx.past, held)]);
      costs.set('pairing.section_repeat', [
        pairs(held).reduce((sum, [a, b]) => sum + ctx.past.meetings(a, b), 0),
      ]);
      judgingCosts(ctx, held, fixture.panel, costs);
      return costs;
    }
  }
};

export const forceOf = (request: EventRequest, key: ForceKey) =>
  request.settings[key].force;

export const isBroken = (cost: readonly number[]) =>
  cost.some((field) => field > 0);

/**
 * An elimination tab round is fixed by the bracket and the results, so no
 * pairing or bye policy applies to its fixtures; judging policies still do.
 */
export const fixtureCosts = (
  ctx: CostContext,
  fixture: Fixture,
): ReadonlyMap<ForceKey, readonly number[]> => {
  const costs = everyCost(ctx, fixture);
  if (ctx.request.stage.kind !== 'elimination') return costs;
  return new Map([...costs].filter(([key]) => key.startsWith('judging.')));
};
