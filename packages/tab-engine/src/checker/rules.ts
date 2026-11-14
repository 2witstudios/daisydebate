import type { Id } from '../shapes/competition';
import type {
  Draw,
  EventRequest,
  ExistingFixture,
  Plan,
  RuleBreak,
} from '../shapes/draw';
import { forceKeys, type ForceKey } from '../shapes/settings';
import { placedOf, sameRef } from './context';
import { fixtureCosts, forceOf, isBroken, type CostContext } from './costs';
import type { Violation } from './verdict';

const isForceKey = (key: string): key is ForceKey =>
  Object.hasOwn(forceKeys, key);

/** Fact 7: no fixture breaks a rule, unless that exact break is overridden. */
export const ruleViolations = (
  ctx: CostContext,
  plan: Plan,
  overrides: readonly RuleBreak[],
): Violation[] => {
  const event = ctx.request.event;
  const violations: Violation[] = [];
  for (const { ref, fixture } of placedOf(plan))
    for (const [key, cost] of fixtureCosts(ctx, fixture)) {
      if (forceOf(ctx.request, key) !== 'rule' || !isBroken(cost)) continue;
      const overridden = overrides.some(
        (o) => o.event === event && o.key === key && sameRef(o.fixture, ref),
      );
      if (!overridden)
        violations.push({
          kind: 'rule_broken',
          event,
          key,
          fixture: ref,
          cost,
        });
    }
  return violations;
};

/** The fields of a cost the checker restates: only a pull-up's record distance. */
const restated = (
  ctx: CostContext,
  key: ForceKey,
  cost: readonly number[],
): readonly number[] | null => {
  if (key !== 'pairing.pull_up') return cost;
  if (ctx.records !== null && !ctx.records.exact) return null;
  return cost.slice(0, 1);
};

const sameFields = (a: readonly number[], b: readonly number[]) =>
  a.length === b.length && a.every((field, i) => field === b[i]);

const zeroLike = (cost: readonly number[]) => cost.map(() => 0);

/** Fact 8: each force key's total and per-fixture terms equal the checker's own count. */
export const costViolations = (ctx: CostContext, draw: Draw): Violation[] => {
  const event = ctx.request.event;
  const violations: Violation[] = [];
  const placed = placedOf(draw).map((p) => ({
    ...p,
    costs: fixtureCosts(ctx, p.fixture),
  }));
  const assessed = draw.assessment.fixtures;
  for (const total of draw.assessment.totals) {
    if (total.key === 'keep') {
      const movable = movableIds(ctx.request);
      const expected = [draw.withdraw.filter((id) => movable.has(id)).length];
      if (!sameFields(expected, total.cost.slice(0, 1)))
        violations.push({
          kind: 'cost_total',
          event,
          key: 'keep',
          expected,
          actual: total.cost,
        });
      continue;
    }
    if (!isForceKey(total.key)) continue;
    const key = total.key;
    const actual = restated(ctx, key, total.cost);
    if (actual === null) continue;
    const sum = actual.map(() => 0);
    for (const p of placed) {
      const mine = p.costs.get(key);
      const term =
        assessed
          .find((a) => sameRef(a.fixture, p.ref))
          ?.terms.find((t) => t.key === key) ?? null;
      const expected = mine === undefined ? null : restated(ctx, key, mine);
      if (expected !== null)
        expected.forEach((field, i) => (sum[i] = (sum[i] ?? 0) + field));
      if (term === null) {
        if (expected !== null && isBroken(expected))
          violations.push({
            kind: 'cost_term',
            event,
            key,
            fixture: p.ref,
            expected,
            actual: null,
          });
        continue;
      }
      const reported = restated(ctx, key, term.cost) ?? [];
      const wanted = expected ?? zeroLike(reported);
      if (!sameFields(wanted, reported))
        violations.push({
          kind: 'cost_term',
          event,
          key,
          fixture: p.ref,
          expected: wanted,
          actual: term.cost,
        });
    }
    if (!sameFields(sum, actual))
      violations.push({
        kind: 'cost_total',
        event,
        key,
        expected: sum,
        actual: total.cost,
      });
  }
  return violations;
};

export const movableIds = (request: EventRequest): ReadonlySet<Id> =>
  new Set(
    (request.existing as readonly ExistingFixture<never>[])
      .filter((e) => e.hold === 'movable')
      .map((e) => e.id),
  );
