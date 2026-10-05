import { buildPlan, drillHref, planTotal, type PlanItem } from './plan';
import type { HubQuery } from './query';
import { recommend } from './recommend';
import type { TrainingSummary } from './summary';

export type PlanRow = PlanItem & { readonly done: boolean };

/** What to do next: the weak-spot drill, or an optional extra once done. */
export type NextUp = {
  readonly kind: 'recommended' | 'optional';
  readonly title: string;
  readonly reason: string;
  readonly minutes: number;
  readonly href: string;
};

export type HubView = {
  /** `done` once every item of the chosen plan is finished. */
  readonly stage: 'plan' | 'done';
  readonly mins: HubQuery['mins'];
  readonly plan: readonly PlanRow[];
  readonly totalMinutes: number;
  readonly next: NextUp | null;
};

/** The hub for an account that has trained, from its summary and URL. */
export function hubView(summary: TrainingSummary, query: HubQuery): HubView {
  const items = buildPlan(query.mins, summary);
  const plan = items.map((item) => ({
    ...item,
    done: query.did.includes(item.id),
  }));
  const stage = plan.every((row) => row.done) ? 'done' : 'plan';
  const spot = recommend(summary.weakSpot);
  return {
    stage,
    mins: query.mins,
    plan,
    totalMinutes: planTotal(items),
    next:
      stage === 'done'
        ? {
            kind: 'optional',
            title: 'Responding drill',
            reason: 'Answer one opposing point in 60 seconds.',
            minutes: 5,
            href: drillHref('responding'),
          }
        : spot && {
            kind: 'recommended',
            title: spot.title,
            reason: spot.reason,
            minutes: spot.minutes,
            href: drillHref(spot.part),
          },
  };
}
