import { compareBytes } from '@daisy/seeded-random';
import type { Fixture, Id } from '../shapes/competition';
import type {
  Draw,
  DrawInput,
  EventRequest,
  ExistingFixture,
} from '../shapes/draw';
import { forceKeys, type ForceKey } from '../shapes/settings';
import { costContext, placedOf, sidesOf } from './context';
import { fixtureCosts, forceOf, isBroken, type CostContext } from './costs';
import { entriesIn } from './past';
import { movableIds } from './rules';
import type { Violation } from './verdict';

/** The most entries a brute force tries: 945 matchings of ten, both ways round. */
const SMALL = 10;

type Candidate = {
  readonly fixture: Fixture;
  readonly costs: ReadonlyMap<ForceKey, readonly number[]>;
  readonly reproduces: boolean;
  readonly clashes: boolean;
};

type Field = {
  readonly toPlace: readonly Id[];
  readonly fixed: readonly Fixture[];
  readonly movable: readonly Fixture[];
};

const sameFixture = (a: Fixture, b: Fixture) => {
  if (a.kind !== b.kind) return false;
  const left = entriesIn(a);
  const right = entriesIn(b);
  return left.length === right.length && left.every((e, i) => e === right[i]);
};

/** A two-sided preliminary field small enough to try every plan of, or null. */
const smallField = (request: EventRequest): Field | null => {
  if (sidesOf(request) !== 2 || request.stage.kind !== 'preliminary')
    return null;
  // A round-robin round is fixed by its circle schedule: there is nothing to search.
  if (
    request.settings['pairing.method'].preliminary.structure === 'round_robin'
  )
    return null;
  const existing = request.existing as readonly ExistingFixture<never>[];
  const status = new Map(request.entries.map((e) => [e.id, e.status]));
  const movable = existing
    .filter((e) => e.hold === 'movable')
    .map((e) => e.fixture as Fixture);
  if (
    movable.some((f) =>
      entriesIn(f).some((entry) => status.get(entry) !== 'active'),
    )
  )
    return null;
  const fixed = existing
    .filter((e) => e.hold === 'fixed')
    .map((e) => e.fixture as Fixture);
  const held = new Set(fixed.flatMap(entriesIn));
  const toPlace = request.entries
    .filter((e) => e.status === 'active' && !held.has(e.id))
    .map((e) => e.id)
    .sort(compareBytes);
  return toPlace.length > SMALL ? null : { toPlace, fixed, movable };
};

/**
 * Every plan of the field: each perfect matching of the entries to place (a
 * bye standing in when their number is odd), each pair either way round.
 * `visit` returns true to stop.
 */
const everyPlan = (
  ctx: CostContext,
  field: Field,
  occupied: ReadonlySet<Id>,
  admissible: (c: Candidate) => boolean,
  visit: (chosen: readonly Candidate[]) => boolean,
) => {
  const members = new Map(ctx.request.entries.map((e) => [e.id, e.members]));
  const prematched =
    ctx.request.settings['pairing.method'].preliminary.structure ===
    'prematched';
  const memo = new Map<string, Candidate>();
  const candidate = (fixture: Fixture): Candidate => {
    const key =
      fixture.kind === 'bye'
        ? `bye\u0000${fixture.entry}`
        : entriesIn(fixture).join('\u0000');
    const known = memo.get(key);
    if (known !== undefined) return known;
    const made: Candidate = {
      fixture,
      costs: fixtureCosts(ctx, fixture),
      reproduces: field.movable.some((m) => sameFixture(m, fixture)),
      clashes:
        fixture.kind !== 'bye' &&
        (entriesIn(fixture).some((e) =>
          (members.get(e) ?? []).some((p) => occupied.has(p)),
        ) ||
          (prematched &&
            fixture.kind === 'pairing' &&
            ctx.past.meetings(fixture.sides[0], fixture.sides[1]) > 0)),
    };
    memo.set(key, made);
    return made;
  };
  const vertices: readonly (Id | null)[] =
    field.toPlace.length % 2 === 1 ? [...field.toPlace, null] : field.toPlace;
  const chosen: Candidate[] = [];
  const walk = (remaining: readonly (Id | null)[]): boolean => {
    if (remaining.length === 0) return visit(chosen);
    const [first, ...rest] = remaining;
    for (const partner of rest) {
      const others = rest.filter((v) => v !== partner);
      const fixtures: Fixture[] =
        first === null || partner === null
          ? [{ kind: 'bye', entry: (first ?? partner)! }]
          : [
              { kind: 'pairing', sides: [first!, partner], panel: [] },
              { kind: 'pairing', sides: [partner, first!], panel: [] },
            ];
      for (const fixture of fixtures) {
        const c = candidate(fixture);
        if (!admissible(c)) continue;
        chosen.push(c);
        const stop = walk(others);
        chosen.pop();
        if (stop) return true;
      }
    }
    return false;
  };
  walk(vertices);
};

const compareVectors = (a: readonly number[], b: readonly number[]) => {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/** The preference fields of one fixture's costs, in the event's preference order. */
const preferenceFields = (
  request: EventRequest,
  costs: ReadonlyMap<ForceKey, readonly number[]>,
): number[] =>
  request.settings['pairing.preference_order'].order.flatMap((key) => {
    if (forceOf(request, key) !== 'preference') return [];
    const cost = costs.get(key) ?? [0, 0];
    if (key !== 'pairing.pull_up') return [cost[0] ?? 0];
    return request.settings['pairing.pull_up'].choose === 'lowest_strength'
      ? [cost[0] ?? 0]
      : [cost[0] ?? 0, cost[1] ?? 0];
  });

const addInto = (into: number[], fields: readonly number[]) =>
  fields.forEach((f, i) => (into[i] = (into[i] ?? 0) + f));

const ruleKeys = (request: EventRequest) =>
  (Object.keys(forceKeys) as ForceKey[]).filter(
    (key) => forceOf(request, key) === 'rule',
  );

const breaksAny = (
  costs: ReadonlyMap<ForceKey, readonly number[]>,
  keys: readonly ForceKey[],
) => keys.some((key) => isBroken(costs.get(key) ?? []));

/** Fact 10: on a small field, no plan that keeps the fixed and breaks no rule is lexicographically better. */
export const optimalityViolations = (
  ctx: CostContext,
  draw: Draw,
  occupied: ReadonlySet<Id>,
): Violation[] => {
  const request = ctx.request;
  // Panels never change a pairing cost: the pairing fields compare with judges or without.
  if (
    request.settings['pairing.method'].preliminary.structure !== 'powered' &&
    request.tabRound !== 1
  )
    return [];
  if (ctx.records !== null && !ctx.records.exact) return [];
  const field = smallField(request);
  if (field === null) return [];
  const rules = ruleKeys(request);
  const fixedCosts = field.fixed.map((f) => fixtureCosts(ctx, f));
  if (fixedCosts.some((costs) => breaksAny(costs, rules))) return [];
  const base: number[] = [];
  for (const costs of fixedCosts)
    addInto(base, preferenceFields(request, costs));
  /**
   * Who takes the bye is settled by `bye.recipient` before the other
   * preferences (only `bye.repeat` comes first), and is checked on its own
   * (`byeViolations`). So the bye is taken as drawn and the rest of the plan
   * is compared.
   */
  const drawnBye = placedOf(draw).find(
    (p) => p.fixture.kind === 'bye',
  )?.fixture;
  const byeAsDrawn = (c: { readonly fixture: Fixture }) =>
    c.fixture.kind !== 'bye' ||
    drawnBye === undefined ||
    (drawnBye.kind === 'bye' && c.fixture.entry === drawnBye.entry);
  let best: number[] | null = null;
  everyPlan(
    ctx,
    field,
    occupied,
    (c) => !c.clashes && !breaksAny(c.costs, rules) && byeAsDrawn(c),
    (chosen) => {
      const prefs = [...base];
      for (const c of chosen)
        addInto(prefs, preferenceFields(request, c.costs));
      const vector = [
        field.movable.length - chosen.filter((c) => c.reproduces).length,
        ...prefs,
      ];
      if (best === null || compareVectors(vector, best) < 0) best = vector;
      return false;
    },
  );
  if (best === null) return [];
  const movable = movableIds(request);
  const prefs: number[] = [];
  for (const { fixture } of placedOf(draw))
    addInto(prefs, preferenceFields(request, fixtureCosts(ctx, fixture)));
  const actual = [
    draw.withdraw.filter((id) => movable.has(id)).length,
    ...prefs,
  ];
  return compareVectors(actual, best) > 0
    ? [{ kind: 'not_optimal', event: request.event, actual, best }]
    : [];
};

/** An infeasible-by-rules answer: no plan keeps the named rules, and dropping any one admits one. */
export const infeasibleRulesViolations = (
  input: DrawInput,
  event: Id,
  rules: readonly ForceKey[],
): Violation[] => {
  const requests = input.call === 'slot' ? input.events : [input.event];
  const request = requests.find((r) => r.event === event);
  if (request === undefined) return [{ kind: 'draw_extra', event }];
  /**
   * What the checker cannot brute force it accepts unchecked: a judging rule
   * (panels are not searched), a field above SMALL, an elimination round, a
   * four-side or speech event, or a round-robin round.
   */
  if (rules.some((key) => key.startsWith('judging.'))) return [];
  const field = smallField(request);
  if (field === null) return [];
  const ctx = costContext(input, request);
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
