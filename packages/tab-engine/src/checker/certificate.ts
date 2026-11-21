import { compareBytes } from '@daisy/seeded-random';
import type { Fixture, Id } from '../shapes/competition';
import type { DrawAnswer, DrawInput, EventRequest } from '../shapes/draw';
import type { ForceKey } from '../shapes/settings';
import { decided, progression } from './bracket';
import { entriesToPlace } from './byes';
import { costContext, placedOf, requestsOf, sidesOf } from './context';
import { fixtureCosts, forceOf, isBroken, type CostContext } from './costs';
import { breaksAny, everyPlan, smallField } from './optimality';
import { isRoundRobin, roundRobinSchedule } from './schedule';
import { eventViolations } from './structure';
import type { Violation } from './verdict';

type RulesAnswer = Extract<
  DrawAnswer,
  { readonly kind: 'infeasible'; readonly cause: 'rules' }
>;

/** Whether a fixture breaks none of `keys`, counted by the checker's own terms. */
const holds = (ctx: CostContext, fixture: Fixture, keys: readonly ForceKey[]) =>
  !breaksAny(fixtureCosts(ctx, fixture), keys);

const invalid = (
  event: Id,
  certificate: RulesAnswer['certificate']['kind'],
  reason: string,
): Violation => ({
  kind: 'infeasible_certificate_invalid',
  event,
  certificate,
  reason,
});

/**
 * A Tutte barrier: in the pairing graph that only the named rules restrict
 * (an edge where some orientation breaks none of them and, prematched, the
 * two have not met; an edge to the bye where that bye breaks none), removing
 * the named vertices leaves more odd components than were removed, so no
 * perfect matching exists.
 */
const barrierViolations = (
  ctx: CostContext,
  rules: readonly ForceKey[],
  removed: readonly (Id | null)[],
): Violation[] => {
  const request = ctx.request;
  const event = request.event;
  const structure = request.settings['pairing.method'].preliminary.structure;
  if (
    request.stage.kind !== 'preliminary' ||
    sidesOf(request) !== 2 ||
    structure === 'round_robin'
  )
    return [invalid(event, 'barrier', 'not a pairing field')];
  const pool = [...entriesToPlace(request)].sort(compareBytes);
  const vertices: readonly (Id | null)[] =
    pool.length % 2 === 1 ? [...pool, null] : pool;
  const gone = new Set<Id | null>();
  for (const v of removed) {
    if (!vertices.includes(v) || gone.has(v))
      return [invalid(event, 'barrier', `removed ${String(v)} is no vertex`)];
    gone.add(v);
  }
  const prematched = structure === 'prematched';
  const joined = (a: Id | null, b: Id | null) => {
    // One vertex at most is the bye.
    if (a === null)
      return b !== null && holds(ctx, { kind: 'bye', entry: b }, rules);
    if (b === null) return holds(ctx, { kind: 'bye', entry: a }, rules);
    if (prematched && ctx.past.meetings(a, b) > 0) return false;
    return (
      holds(ctx, { kind: 'pairing', sides: [a, b], panel: [] }, rules) ||
      holds(ctx, { kind: 'pairing', sides: [b, a], panel: [] }, rules)
    );
  };
  const left = vertices.filter((v) => !gone.has(v));
  const seen = new Set<Id | null>();
  let odd = 0;
  for (const start of left) {
    if (seen.has(start)) continue;
    seen.add(start);
    const queue = [start];
    let size = 0;
    for (let at = queue.pop(); at !== undefined; at = queue.pop()) {
      size += 1;
      for (const next of left)
        if (!seen.has(next) && joined(at, next)) {
          seen.add(next);
          queue.push(next);
        }
    }
    if (size % 2 === 1) odd += 1;
  }
  return odd > removed.length
    ? []
    : [
        invalid(
          event,
          'barrier',
          `${odd} odd components left by removing ${removed.length}`,
        ),
      ];
};

/** More entries of one school than there are sections: two must share one. */
const schoolCountViolations = (
  request: EventRequest,
  rules: readonly ForceKey[],
  certificate: Extract<
    RulesAnswer['certificate'],
    { readonly kind: 'school_count' }
  >,
): Violation[] => {
  const event = request.event;
  const pool = entriesToPlace(request);
  const target = request.settings['pairing.section_size'].target;
  const entries = request.entries.filter(
    (e) =>
      pool.has(e.id) &&
      e.protection.some(
        (p) => p.scope === 'school' && p.key === certificate.school,
      ),
  ).length;
  const sections = Math.max(
    1,
    Math.floor((2 * pool.size + target) / (2 * target)),
  );
  const reasons = [
    ...(rules.includes('pairing.same_school')
      ? []
      : ['pairing.same_school not named']),
    // A lower bound: an entry carrying the school anywhere in its protection keys shares it, so the certificate may count fewer than there are.
    ...(certificate.entries <= entries
      ? []
      : [
          `the school has ${entries} entries, fewer than ${certificate.entries}`,
        ]),
    ...(certificate.sections === sections
      ? []
      : [`there are ${sections} sections, not ${certificate.sections}`]),
    ...(certificate.entries > sections ? [] : ['the school fits the sections']),
  ];
  return reasons.map((r) => invalid(event, 'school_count', r));
};

/** The round-robin schedule itself breaks every named rule. */
const scheduleCertificateViolations = (
  input: DrawInput,
  ctx: CostContext,
  rules: readonly ForceKey[],
): Violation[] => {
  const request = ctx.request;
  if (!isRoundRobin(request))
    return [invalid(request.event, 'schedule', 'not a round-robin round')];
  const schedule = roundRobinSchedule(input, request);
  return rules
    .filter(
      (key) =>
        !schedule.some((f) => isBroken(fixtureCosts(ctx, f).get(key) ?? [])),
    )
    .map((key) =>
      invalid(request.event, 'schedule', `the schedule keeps ${key}`),
    );
};

/** Each named rule has a witness: a sound plan holding every other named rule. */
const witnessViolations = (
  ctx: CostContext,
  answer: RulesAnswer,
): Violation[] => {
  const request = ctx.request;
  const event = request.event;
  return answer.rules.flatMap((key): Violation[] => {
    const witness = answer.witnesses.find((w) => w.key === key);
    if (witness === undefined)
      return [{ kind: 'infeasible_witness_missing', event, key }];
    const others = answer.rules.filter((k) => k !== key);
    const found: Violation[] =
      witness.plan.event === event
        ? [
            ...eventViolations(request, witness.plan),
            ...placedOf(witness.plan).flatMap(({ ref, fixture }) =>
              [...fixtureCosts(ctx, fixture)]
                .filter(([k, cost]) => others.includes(k) && isBroken(cost))
                .map(([k, cost]): Violation => ({
                  kind: 'rule_broken',
                  event,
                  key: k,
                  fixture: ref,
                  cost,
                })),
            ),
          ]
        : [{ kind: 'draw_extra', event: witness.plan.event }];
    return found.length === 0
      ? []
      : [{ kind: 'infeasible_witness_invalid', event, key, found }];
  });
};

/**
 * The brute force kept from before, for a small two-sided preliminary field:
 * no plan holds the named rules, and dropping any one admits one.
 */
const bruteForceViolations = (
  input: DrawInput,
  ctx: CostContext,
  rules: readonly ForceKey[],
): Violation[] => {
  const request = ctx.request;
  const event = request.event;
  const field = smallField(request);
  if (field === null) return [];
  const occupied = new Set(
    input.call === 'slot' ? input.commitments.flatMap((c) => c.people) : [],
  );
  const feasible = (keys: readonly ForceKey[]) => {
    if (field.fixed.some((f) => breaksAny(fixtureCosts(ctx, f), keys)))
      return false;
    let found = false;
    everyPlan(
      ctx,
      field,
      occupied,
      (c) => !c.clashes && !breaksAny(c.costs, keys),
      () => {
        found = true;
        return true;
      },
    );
    return found;
  };
  if (feasible(rules))
    return [{ kind: 'infeasible_rules_feasible', event, rules }];
  return rules
    .filter((key) => !feasible(rules.filter((k) => k !== key)))
    .map((key): Violation => ({
      kind: 'infeasible_rules_not_minimal',
      event,
      key,
    }));
};

/** An infeasible-by-rules answer: its certificate holds, every named rule is needed, and none is a judging rule. */
export const infeasibleRulesViolations = (
  input: DrawInput,
  answer: RulesAnswer,
): Violation[] => {
  const event = answer.event;
  const request = requestsOf(input).find((r) => r.event === event);
  if (request === undefined) return [{ kind: 'draw_extra', event }];
  const ctx = costContext(input, request);
  const named = answer.rules.flatMap((key): Violation[] =>
    key.startsWith('judging.') || forceOf(request, key) !== 'rule'
      ? [
          {
            kind: 'infeasible_rules_key',
            event,
            key,
            reason: key.startsWith('judging.') ? 'judging' : 'not_a_rule',
          },
        ]
      : [],
  );
  if (named.length > 0) return named;
  const certificate = answer.certificate;
  const proof = (() => {
    switch (certificate.kind) {
      case 'barrier':
        return barrierViolations(ctx, answer.rules, certificate.removed);
      case 'school_count':
        return schoolCountViolations(request, answer.rules, certificate);
      case 'schedule':
        return scheduleCertificateViolations(input, ctx, answer.rules);
    }
  })();
  return [
    ...proof,
    ...witnessViolations(ctx, answer),
    ...bruteForceViolations(input, ctx, answer.rules),
  ];
};

/**
 * No plan at all: the bracket is decided (one entry left, nobody to meet),
 * or a prematched field has no pairing of unmet pairs. Any other
 * preliminary field always has a plan once every rule is relaxed, so a
 * no_plan there is refused. A prematched field above the brute force's
 * size is accepted unchecked.
 */
export const noPlanViolations = (
  input: DrawInput,
  request: EventRequest,
): Violation[] => {
  const unfounded: Violation[] = [
    { kind: 'infeasible_no_plan_unfounded', event: request.event },
  ];
  const p = progression(request);
  if (p !== null) return p.kind === 'round' && decided(p) ? [] : unfounded;
  // With every rule relaxed, a powered, round-robin, four-side or speech field always has a plan.
  if (
    request.format.outcome !== 'winner' ||
    request.settings['pairing.method'].preliminary.structure !== 'prematched'
  )
    return unfounded;
  const field = smallField(request);
  if (field === null) return [];
  const found = everyPlan(
    costContext(input, request),
    field,
    new Set(),
    (c) => !c.clashes,
    () => true,
  );
  return found ? unfounded : [];
};
