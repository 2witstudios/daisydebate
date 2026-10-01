import { z } from 'zod';
import type { SearchParams } from '../access/decision';
import { formatClock, windowLabel } from './clock';
import { judgeRoutes } from './routes';

/**
 * The mock flow driver. Matchmaking has no backend yet, so each screen's
 * place in the flow is read from its URL and mapped to a view model here.
 * Screens only render a view model and follow the links in it; the real
 * pool, offers and debates replace this module and nothing else.
 */

const first = (value: string | readonly string[] | undefined) =>
  typeof value === 'string' ? value : value?.[0];

const waitingSteps = ['waiting', 'left'] as const;

/** In the judge pool, or having cancelled out of it. */
export type WaitingStep = (typeof waitingSteps)[number];

const waitingSchema = z.enum(waitingSteps).catch('waiting');

/** Reads the waiting screen's step; anything unknown is still waiting. */
export const parseWaitingStep = (params: SearchParams): WaitingStep =>
  waitingSchema.parse(first(params['step']));

/** Where sample matchmaking stands: the wait so far and the offer window. */
export type PoolStatus = {
  readonly waitedSeconds: number;
  readonly offerWindowSeconds: number;
};

export type WaitingView = {
  readonly step: WaitingStep;
  readonly waited: string;
  readonly offerWindow: string;
  /** Leaves the pool. */
  readonly cancelHref: string;
  /** Joins the pool again after leaving it. */
  readonly restartHref: string;
  readonly hubHref: string;
};

export const waitingView = (
  step: WaitingStep,
  pool: PoolStatus,
): WaitingView => ({
  step,
  waited: formatClock(pool.waitedSeconds),
  offerWindow: windowLabel(pool.offerWindowSeconds),
  cancelHref: `${judgeRoutes.waiting}?step=left`,
  restartHref: judgeRoutes.waiting,
  hubHref: judgeRoutes.hub,
});
