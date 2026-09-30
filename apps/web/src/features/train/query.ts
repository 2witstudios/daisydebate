import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { trainDestinations } from './actions';
import {
  planItemIds,
  planMinutes,
  type PlanItemId,
  type PlanMinutes,
} from './plan';

/**
 * The hub's URL state. `did` carries the plan items already finished: the
 * mock flow's stand-in for the account's sessions today, which the backend
 * read derives instead.
 */
export type HubQuery = {
  readonly mins: PlanMinutes;
  readonly did: readonly PlanItemId[];
};

export const defaultHubQuery: HubQuery = { mins: 20, did: [] };

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const didSchema = z
  .string()
  .transform((value) => {
    const named = new Set(value.split(','));
    return planItemIds.filter((id) => named.has(id));
  })
  .catch([]);

const minsSchema = z
  .enum(planMinutes.map(String) as [string, ...string[]])
  .transform((value) => Number(value) as PlanMinutes)
  .catch(defaultHubQuery.mins);

/** Reads the hub's URL state; bad or missing values become defaults. */
export const parseHubQuery = (params: SearchParams): HubQuery => ({
  mins: minsSchema.parse(first(params['mins'])),
  did: didSchema.parse(first(params['did']) ?? ''),
});

const contextParams = (query: HubQuery): string => {
  const params = new URLSearchParams();
  if (query.mins !== defaultHubQuery.mins)
    params.set('mins', String(query.mins));
  if (query.did.length > 0) params.set('did', query.did.join(','));
  return params.toString();
};

/** The hub URL for a query, carrying only the non-default values. */
export function hubHref(query: HubQuery): string {
  const search = contextParams(query);
  return search === ''
    ? trainDestinations.hub
    : `${trainDestinations.hub}?${search}`;
}

/** A flow's URL with the plan's time and finished items riding along. */
export function withPlanContext(href: string, query: HubQuery): string {
  const search = contextParams(query);
  if (search === '') return href;
  return `${href}${href.includes('?') ? '&' : '?'}${search}`;
}

/** The weekly goals the first-visit picker offers, in sessions a week. */
export const weeklyGoals = [1, 2, 3, 5] as const;
export type WeeklyGoal = (typeof weeklyGoals)[number];

const goalSchema = z
  .enum(weeklyGoals.map(String) as [string, ...string[]])
  .transform((value): WeeklyGoal | 0 => Number(value) as WeeklyGoal)
  .catch(0);

/** The goal the welcome page shows as chosen; zero while none is. */
export const parseWelcomeGoal = (params: SearchParams): WeeklyGoal | 0 =>
  goalSchema.parse(first(params['goal']));
