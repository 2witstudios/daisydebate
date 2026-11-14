import { callContext, draw, peopleOf, requestsOf } from '../draw';
import { entriesOf } from '../draw/facts';
import { prepare } from '../draw/prepare';
import type { Id } from '../shapes/competition';
import type {
  Assessment,
  CostKey,
  Draw,
  DrawInput,
  EventRequest,
  ExistingFixture,
  FixtureRef,
  Plan,
} from '../shapes/draw';
import { assessPlan, callFacts, placedOf } from './assessment';

/**
 * Costs and explains any plan for a draw input, engine-made or changed by a
 * person: the same function the engine passes its own draws through. A
 * broken rule is reported, never relaxed; the plan comes back as given.
 */
export const assess = (
  input: DrawInput,
  plans: readonly Plan[],
): Assessment[] => {
  const prepared = requestsOf(input).map((request) =>
    prepare(request, input.seed),
  );
  const context = callContext(input);
  const shared = callFacts(
    plans,
    context,
    peopleOf(prepared.map((p) => p.request)),
  );
  return plans.map((plan) => {
    const p = prepared.find((x) => x.request.event === plan.event)!;
    const assessment = assessPlan(p, plan, context);
    return { ...assessment, invalid: [...assessment.invalid, ...shared] };
  });
};

export type WhyNot =
  | {
      readonly kind: 'answered';
      /** Each cost key whose total differs, as pinned minus drawn. */
      readonly difference: readonly {
        readonly key: CostKey;
        readonly cost: readonly number[];
      }[];
      /** Fixtures of the drawn plan that the pinned plan does not keep. */
      readonly changed: readonly FixtureRef[];
      readonly pinned: Plan;
    }
  | { readonly kind: 'impossible' };

const totalsOf = (assessment: Assessment) =>
  new Map(assessment.totals.map((t) => [t.key, t.cost]));

/**
 * "Why not A against C": pins that fixture, solves again, and returns the
 * difference field by field with every fixture that would change. The pin
 * is a fixed fixture the engine must keep; nothing else about the input moves.
 */
const PIN = '\u0000pinned';

/** The draw with one fixture pinned, or null when no draw holds it. */
const drawPinned = (input: DrawInput, event: Id, entries: readonly Id[]) => {
  const pin = (request: EventRequest): EventRequest => {
    if (request.event !== event) return request;
    const fixture =
      request.format.outcome === 'winner' || 'sides' in request.format
        ? { kind: 'pairing', sides: entries, panel: [] }
        : { kind: 'section', speakers: entries, panel: [] };
    const pinned = {
      id: PIN,
      fixture,
      hold: 'fixed',
    } as ExistingFixture<never>;
    return {
      ...request,
      existing: [...request.existing, pinned],
    } as EventRequest;
  };
  const answer = draw(
    input.call === 'slot'
      ? { ...input, events: input.events.map(pin) }
      : { ...input, event: pin(input.event) },
  );
  return answer.kind === 'drawn'
    ? answer.draws.find((d) => d.event === event)!
    : null;
};

const differenceOf = (before: Assessment, after: Assessment) => {
  const [x, y] = [totalsOf(before), totalsOf(after)];
  const keys = [...new Set([...x.keys(), ...y.keys()])].sort();
  return keys.flatMap((key) => {
    const a = x.get(key) ?? [];
    const b = y.get(key) ?? [];
    const diff = Array.from(
      { length: Math.max(a.length, b.length) },
      (_, i) => (b[i] ?? 0) - (a[i] ?? 0),
    );
    return diff.some((d) => d !== 0) ? [{ key, cost: diff }] : [];
  });
};

/**
 * "Why not A against C": pins that fixture, solves again, and returns the
 * difference field by field with every fixture that would change. A pair is
 * pinned as a pair: both orientations are tried and the cheaper kept, so the
 * question does not choose the sides. The pin comes back as an added
 * fixture; the engine mints no id.
 */
export const whyNot = (
  input: DrawInput,
  event: Id,
  entries: readonly Id[],
): WhyNot => {
  const drawn = draw(input);
  if (drawn.kind !== 'drawn') return { kind: 'impossible' };
  const before = drawn.draws.find((d) => d.event === event)!;
  const orders =
    entries.length === 2 ? [entries, [entries[1]!, entries[0]!]] : [entries];
  const total = (d: Draw) =>
    differenceOf(before.assessment, d.assessment).reduce(
      (sum, t) => sum + t.cost.reduce((a, c) => a + c, 0),
      0,
    );
  const candidates = orders.flatMap((order) => {
    const d = drawPinned(input, event, order);
    return d === null ? [] : [d];
  });
  const after = [...candidates].sort((a, b) => total(a) - total(b))[0];
  if (after === undefined) return { kind: 'impossible' };
  const pinned = after.keep.find((k) => k.id === PIN)!;
  const plan = {
    event: after.event,
    keep: after.keep.filter((k) => k.id !== PIN),
    add: [
      ...after.add,
      { ordinal: after.add.length + 1, fixture: pinned.fixture },
    ],
    withdraw: after.withdraw,
  } as Plan;
  const signature = (f: Parameters<typeof entriesOf>[0]) =>
    `${f.kind}:${[...entriesOf(f)].sort().join('|')}`;
  const kept = new Set(placedOf(plan).map((p) => signature(p.fixture)));
  const changed = placedOf(before)
    .filter((p) => !kept.has(signature(p.fixture)))
    .map((p) => p.ref);
  return {
    kind: 'answered',
    difference: differenceOf(before.assessment, after.assessment),
    changed,
    pinned: plan,
  };
};
