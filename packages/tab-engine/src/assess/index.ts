import { callContext, draw, peopleOf, requestsOf } from '../draw';
import { entriesOf } from '../draw/facts';
import { prepare } from '../draw/prepare';
import type { Id } from '../shapes/competition';
import type { Assessment, CostKey, DrawInput, EventRequest, ExistingFixture, FixtureRef, Plan } from '../shapes/draw';
import { assessPlan, callFacts, placedOf } from './assessment';

/**
 * Costs and explains any plan for a draw input, engine-made or changed by a
 * person: the same function the engine passes its own draws through. A
 * broken rule is reported, never relaxed; the plan comes back as given.
 */
export const assess = (input: DrawInput, plans: readonly Plan[]): Assessment[] => {
  const prepared = requestsOf(input).map((request) => prepare(request, input.seed));
  const context = callContext(input);
  const shared = callFacts(plans, context, peopleOf(prepared.map((p) => p.request)));
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
      readonly difference: readonly { readonly key: CostKey; readonly cost: readonly number[] }[];
      /** Fixtures of the drawn plan that the pinned plan does not keep. */
      readonly changed: readonly FixtureRef[];
      readonly pinned: Plan;
    }
  | { readonly kind: 'impossible' };

const totalsOf = (assessment: Assessment) => new Map(assessment.totals.map((t) => [t.key, t.cost]));

/**
 * "Why not A against C": pins that fixture, solves again, and returns the
 * difference field by field with every fixture that would change. The pin
 * is a fixed fixture the engine must keep; nothing else about the input moves.
 */
export const whyNot = (input: DrawInput, event: Id, entries: readonly Id[]): WhyNot => {
  const drawn = draw(input);
  if (drawn.kind !== 'drawn') return { kind: 'impossible' };
  const pin = (request: EventRequest): EventRequest => {
    if (request.event !== event) return request;
    const fixture =
      request.format.outcome === 'winner' || 'sides' in request.format
        ? { kind: 'pairing', sides: entries, panel: [] }
        : { kind: 'section', speakers: entries, panel: [] };
    const pinned = { id: '\u0000pinned', fixture, hold: 'fixed' } as ExistingFixture<never>;
    return { ...request, existing: [...request.existing, pinned] } as EventRequest;
  };
  const pinnedInput: DrawInput =
    input.call === 'slot' ? { ...input, events: input.events.map(pin) } : { ...input, event: pin(input.event) };
  const again = draw(pinnedInput);
  if (again.kind !== 'drawn') return { kind: 'impossible' };
  const before = drawn.draws.find((d) => d.event === event)!;
  const after = again.draws.find((d) => d.event === event)!;
  const [x, y] = [totalsOf(before.assessment), totalsOf(after.assessment)];
  const keys = [...new Set([...x.keys(), ...y.keys()])].sort();
  const difference = keys.flatMap((key) => {
    const a = x.get(key) ?? [];
    const b = y.get(key) ?? [];
    const diff = Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (b[i] ?? 0) - (a[i] ?? 0));
    return diff.some((d) => d !== 0) ? [{ key, cost: diff }] : [];
  });
  const signature = (f: Parameters<typeof entriesOf>[0]) => `${f.kind}:${entriesOf(f).join('|')}`;
  const kept = new Set(placedOf(after).map((p) => signature(p.fixture)));
  const changed = placedOf(before)
    .filter((p) => !kept.has(signature(p.fixture)))
    .map((p) => p.ref);
  return { kind: 'answered', difference, changed, pinned: after };
};
