import { trainDestinations } from './actions';
import { recommend } from './recommend';
import type { StructurePart, TrainingSummary } from './summary';

/** The time choices for today's plan, in minutes. */
export const planMinutes = [10, 20, 40] as const;
export type PlanMinutes = (typeof planMinutes)[number];

export const planItemIds = [
  'review',
  'impact-drill',
  'responding-drill',
  'guided-practice',
] as const;
export type PlanItemId = (typeof planItemIds)[number];

type PlanKind = 'review' | 'drill' | 'practice';

export type PlanItem = {
  readonly id: PlanItemId;
  readonly kind: PlanKind;
  readonly title: string;
  /** What the item asks of the account today. */
  readonly meta: string;
  /** What it says once done. */
  readonly doneMeta: string;
  readonly minutes: number;
  readonly href: string;
  readonly cta: string;
};

type Fixed = Omit<PlanItem, 'meta' | 'doneMeta' | 'cta'>;

/** A drill's URL: one drill screen, told which part to practise. */
export const drillHref = (part: StructurePart): string =>
  `${trainDestinations.drill}?kind=${part}`;

const impactDrill: Fixed = {
  id: 'impact-drill',
  kind: 'drill',
  title: 'Impact drill',
  minutes: 8,
  href: drillHref('impact'),
};

const planFor = (mins: PlanMinutes, summary: TrainingSummary): PlanItem[] => {
  const { due } = summary.saved;
  const review: PlanItem = {
    id: 'review',
    kind: 'review',
    title: 'Spaced review',
    meta: `${due} ${due === 1 ? 'argument' : 'arguments'} due`,
    doneMeta: `${due} of ${due} reviewed`,
    minutes: 5,
    href: trainDestinations.review,
    cta: `Review ${due}`,
  };
  const drill = (
    minutes: number,
    meta: string,
    doneMeta: string,
  ): PlanItem => ({
    ...impactDrill,
    minutes,
    meta,
    doneMeta,
    cta: 'Start',
  });
  if (mins === 10)
    return [
      review,
      drill(5, 'One short round on your weakest part', 'One round done'),
    ];
  const twoRounds = drill(
    8,
    'Two rounds on your weakest part',
    'Two rounds, 1 argument saved',
  );
  if (mins === 20)
    return [
      review,
      twoRounds,
      {
        id: 'responding-drill',
        kind: 'drill',
        title: 'Responding drill',
        meta: 'Answer one opposing point in 60 seconds',
        doneMeta: 'One point answered',
        minutes: 7,
        href: drillHref('responding'),
        cta: 'Start',
      },
    ];
  return [
    review,
    twoRounds,
    {
      id: 'guided-practice',
      kind: 'practice',
      title: 'Guided practice',
      meta: 'Aff side, solo, sample motion',
      doneMeta: 'One practice debate',
      minutes: 27,
      href: trainDestinations.practice,
      cta: 'Set up',
    },
  ];
};

/** The plan for the time available, most useful first. */
export const buildPlan = (
  mins: PlanMinutes,
  summary: TrainingSummary,
): readonly PlanItem[] => {
  const plan = planFor(mins, summary);
  const spot = recommend(summary.weakSpot);
  return plan.map((item) =>
    item.id === 'impact-drill' && spot !== null
      ? { ...item, title: spot.title, href: drillHref(spot.part) }
      : item,
  );
};

export const planTotal = (plan: readonly PlanItem[]): number =>
  plan.reduce((sum, item) => sum + item.minutes, 0);
