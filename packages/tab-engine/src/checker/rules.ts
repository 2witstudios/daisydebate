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

/**
 * The fields of a cost the checker restates: all of them, but for a pull-up
 * chosen by lowest strength, whose second field (a strength) is not restated,
 * and a pull-up whose records rest on a bye's average, which is not restated.
 */
const restated = (
  ctx: CostContext,
  key: ForceKey,
  cost: readonly number[],
): readonly number[] | null => {
  if (key !== 'pairing.pull_up') return cost;
  if (ctx.records !== null && !ctx.records.exact) return null;
  return ctx.request.settings['pairing.pull_up'].choose === 'lowest_strength'
    ? cost.slice(0, 1)
    : cost.slice(0, 2);
};

/** Field by field, a missing field counting as zero. */
const sameFields = (a: readonly number[], b: readonly number[]) =>
  Array.from({ length: Math.max(a.length, b.length) }).every(
    (_, i) => (a[i] ?? 0) === (b[i] ?? 0),
  );

const zeroLike = (cost: readonly number[]) => cost.map(() => 0);

/** Every break of the given force in a plan: a key of that force whose restated cost is above zero. */
export const breaksOf = (
  ctx: CostContext,
  plan: Plan,
  force: 'rule' | 'warning',
): RuleBreak[] => {
  const event = ctx.request.event;
  return placedOf(plan).flatMap(({ ref, fixture }) =>
    [...fixtureCosts(ctx, fixture)].flatMap(([key, cost]) => {
      const fields = restated(ctx, key, cost);
      return forceOf(ctx.request, key) === force &&
        fields !== null &&
        isBroken(fields)
        ? [{ event, key, fixture: ref }]
        : [];
    }),
  );
};

/** Whether a reported break is one the checker cannot restate (a pull-up on a bye's average). */
const unrestatable = (ctx: CostContext, b: RuleBreak) =>
  b.key === 'pairing.pull_up' && ctx.records !== null && !ctx.records.exact;

const sameBreak = (a: RuleBreak, b: RuleBreak) =>
  a.event === b.event && a.key === b.key && sameRef(a.fixture, b.fixture);

export const breaksDifference = (
  expected: readonly RuleBreak[],
  actual: readonly RuleBreak[],
) => ({
  missing: expected.filter((e) => !actual.some((a) => sameBreak(a, e))),
  extra: actual.filter((a) => !expected.some((e) => sameBreak(a, e))),
});

/** Fact 8: each applied force key's total and per-fixture terms, and the break lists, equal the checker's own count. */
export const costViolations = (ctx: CostContext, draw: Draw): Violation[] => {
  const event = ctx.request.event;
  const violations: Violation[] = [];
  const placed = placedOf(draw).map((p) => ({
    ...p,
    costs: fixtureCosts(ctx, p.fixture),
  }));
  const assessed = draw.assessment.fixtures;
  const totals = new Map(draw.assessment.totals.map((t) => [t.key, t.cost]));
  const keep = totals.get('keep');
  if (keep !== undefined) {
    const movable = movableIds(ctx.request);
    const expected = [draw.withdraw.filter((id) => movable.has(id)).length];
    if (!sameFields(expected, keep.slice(0, 1)))
      violations.push({
        kind: 'cost_total',
        event,
        key: 'keep',
        expected,
        actual: keep,
      });
  }
  for (const key of Object.keys(forceKeys) as ForceKey[]) {
    if (forceOf(ctx.request, key) === 'off') continue;
    if (restated(ctx, key, []) === null) continue;
    const sum: number[] = [];
    for (const p of placed) {
      const mine = p.costs.get(key);
      const expected = mine === undefined ? null : restated(ctx, key, mine);
      if (expected !== null)
        expected.forEach((field, i) => (sum[i] = (sum[i] ?? 0) + field));
      const term =
        assessed
          .find((a) => sameRef(a.fixture, p.ref))
          ?.terms.find((t) => t.key === key) ?? null;
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
    const total = totals.get(key);
    const reported = total === undefined ? null : restated(ctx, key, total);
    if (reported === null ? isBroken(sum) : !sameFields(sum, reported ?? []))
      violations.push({
        kind: 'cost_total',
        event,
        key,
        expected: sum,
        actual: total ?? null,
      });
  }
  for (const [kind, force, listed] of [
    ['assessment_broken', 'rule', draw.assessment.broken],
    ['assessment_warnings', 'warning', draw.assessment.warnings],
  ] as const) {
    const { missing, extra } = breaksDifference(
      breaksOf(ctx, draw, force),
      listed.filter((b) => !unrestatable(ctx, b)),
    );
    if (missing.length > 0 || extra.length > 0)
      violations.push({ kind, event, missing, extra });
  }
  if (draw.assessment.invalid.length > 0)
    violations.push({
      kind: 'assessment_invalid',
      event,
      invalid: draw.assessment.invalid,
    });
  return violations;
};

export const movableIds = (request: EventRequest): ReadonlySet<Id> =>
  new Set(
    (request.existing as readonly ExistingFixture<never>[])
      .filter((e) => e.hold === 'movable')
      .map((e) => e.id),
  );
