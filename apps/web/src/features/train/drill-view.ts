import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { drillContent } from '../../ui/mock/train-drill';
import { trainDestinations } from './actions';
import { parseHubQuery, withDone, withPlanContext, type HubQuery } from './query';
import type { PlanItemId } from './plan';
import type { StructurePart } from './summary';

const kinds = ['claim', 'warrant', 'responding', 'impact'] as const;

/** The drill's URL state: which part, which round, and the plan around it. */
export type DrillQuery = {
  readonly kind: StructurePart;
  readonly round: number;
  readonly plan: HubQuery;
};

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

/** Rounds in a drill session: a short plan has one, the others two. */
export const roundsFor = (plan: HubQuery): number => (plan.mins === 10 ? 1 : 2);

export function parseDrillQuery(params: SearchParams): DrillQuery {
  const plan = parseHubQuery(params);
  const round = z
    .string()
    .regex(/^\d$/)
    .transform(Number)
    .catch(1)
    .parse(first(params['round']));
  return {
    kind: z.enum(kinds).catch('impact').parse(first(params['kind'])),
    round: Math.min(Math.max(round, 1), roundsFor(plan)),
    plan,
  };
}

const drillItem = (kind: StructurePart): PlanItemId =>
  kind === 'responding' ? 'responding-drill' : 'impact-drill';

export type DrillScreen = {
  readonly title: string;
  readonly motion: string;
  readonly task: string;
  readonly round: number;
  readonly rounds: number;
  readonly progress: number;
  readonly backHref: string;
  /** After a save: the next round, or back to the plan with this drill done. */
  readonly afterSave: { readonly label: string; readonly href: string };
  readonly reviewHref: string;
};

const drillHref = (query: DrillQuery, round: number): string =>
  withPlanContext(
    `${trainDestinations.drill}?kind=${query.kind}&round=${round}`,
    query.plan,
  );

/** What the drill screen shows around its form. */
export function drillScreen(query: DrillQuery): DrillScreen {
  const content = drillContent[query.kind];
  const prompt = content.rounds[(query.round - 1) % content.rounds.length];
  const rounds = roundsFor(query.plan);
  const last = query.round >= rounds;
  return {
    title: content.title,
    motion: prompt?.motion ?? '',
    task: prompt?.task ?? '',
    round: query.round,
    rounds,
    progress: Math.round(((query.round - 1) / rounds) * 100),
    backHref: withPlanContext(trainDestinations.hub, query.plan),
    afterSave: last
      ? {
          label: 'Back to Train',
          href: withPlanContext(
            trainDestinations.hub,
            withDone(query.plan, drillItem(query.kind)),
          ),
        }
      : {
          label: 'Another drill',
          href: drillHref(query, query.round + 1),
        },
    reviewHref: withPlanContext(trainDestinations.review, query.plan),
  };
}
