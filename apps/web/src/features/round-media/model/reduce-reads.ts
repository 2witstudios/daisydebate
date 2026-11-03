import type { RoundMediaState } from '@daisy/protocol';
import {
  decideMediaRead,
  decideSupersededRead,
  MEDIA_READ_LET_FINISH_MS,
  type MediaReadEvent,
} from '../media-read-intent';
import { finish, release, whyOf } from './connection-lifecycle';
import type { PlannedEffect } from './media-step';
import type { RequestFailure } from './media-events';
import type {
  Freshness,
  LiveConnection,
  MediaState,
  ReadFlight,
} from './media-state';
import {
  cancel,
  moved,
  prepend,
  rejected,
  schedule,
  withLive,
  type Decision,
  type StepContext,
} from './media-step';
import { requestRead, startNextRead } from './read-start';
import { armRecovery } from './recovery-pace';
import { beginApply } from './reduce-apply';

const clearFlight = (live: LiveConnection): LiveConnection => ({
  ...live,
  reads: { ...live.reads, flight: null },
});

const withFreshness = (
  live: LiveConnection,
  freshness: Freshness,
): LiveConnection =>
  live.establishment.stage === 'established'
    ? { ...live, establishment: { ...live.establishment, freshness } }
    : live;

/** What a superseding event does to the read in flight. */
const supersedeFlight = (
  live: LiveConnection,
  flight: ReadFlight,
  atMs: number,
): { flight: ReadFlight | null; effects: readonly PlannedEffect[] } => {
  if (flight.stage === 'pausing')
    return { flight: null, effects: [cancel('read-retry')] };
  if (flight.stage !== 'requesting') return { flight, effects: [] };
  const age = atMs - flight.startedAtMs;
  return decideSupersededRead({
    supersededSinceAnswer: live.reads.supersededSinceAnswer,
    readAgeMs: age,
  }) === 'abort'
    ? {
        flight: { ...flight, stage: 'aborting' },
        effects: [{ type: 'abort-read', ticket: flight.ticket }],
      }
    : {
        flight: { ...flight, stage: 'letting-finish' },
        effects: [
          schedule(
            'read-let-finish',
            Math.max(0, MEDIA_READ_LET_FINISH_MS - age),
          ),
        ],
      };
};

export const reduceReadRequest = (
  state: MediaState,
  read: MediaReadEvent,
  ctx: StepContext,
): Decision => {
  const decision = decideMediaRead(state.intent, read);
  if (decision.action === 'ignore') return rejected(state);
  const next = { ...state, intent: decision.intent };
  const live = state.link.phase === 'live' ? state.link : null;
  if (!live) return decision.action === 'wake' ? rejected(state) : moved(next);
  if (decision.action === 'wake') {
    const step = requestRead(next, live);
    return step.state.link === state.link && step.effects.length === 0
      ? rejected(state)
      : step;
  }
  // Superseded: the old ticket is invalid before its abort, and its reply is fenced.
  const superseded = live.reads.flight
    ? supersedeFlight(live, live.reads.flight, ctx.atMs)
    : { flight: null, effects: [] };
  const { establishment } = live;
  const budgeted: LiveConnection = {
    ...(establishment.stage === 'established' &&
    establishment.freshness.status === 'current'
      ? withFreshness(live, { status: 'checking' })
      : live),
    reads: {
      ...live.reads,
      flight: superseded.flight,
      supersededSinceAnswer: live.reads.supersededSinceAnswer + 1,
    },
    // An older answer waiting to apply may no longer start.
    apply: live.apply && { ...live.apply, next: null },
  };
  const budget =
    state.timers['read-budget'] === undefined
      ? [schedule('read-budget', ctx.policy.readBudgetMs)]
      : [];
  return prepend(
    [...superseded.effects, ...budget],
    requestRead(next, budgeted),
  );
};

/** A read's outcome is in; the next wanted read may go. */
const leaveFlight = (
  state: MediaState,
  live: LiveConnection,
  atMs: number,
): Decision =>
  prepend(
    live.reads.flight?.stage === 'letting-finish'
      ? [cancel('read-let-finish')]
      : [],
    startNextRead(state, clearFlight(live), atMs),
  );

export const reduceReadAnswered = (
  state: MediaState,
  live: LiveConnection,
  flight: ReadFlight,
  answer: RoundMediaState,
  ctx: StepContext,
): Decision => {
  if (flight.generation !== state.intent.generation)
    return leaveFlight(state, live, ctx.atMs);
  if (answer.state === 'ended') return finish(state, [{ type: 'forget-mute' }]);
  if (answer.state !== 'ready') return release(state, 'definite', ctx);
  const pending = { generation: flight.generation, answer };
  const cleared = clearFlight(live);
  return cleared.apply
    ? startNextRead(
        state,
        { ...cleared, apply: { ...cleared.apply, next: pending } },
        ctx.atMs,
      )
    : beginApply(state, cleared, pending, ctx);
};

/** The answer is overdue or unobtainable: live tracks stay, and it is said plainly. */
export const showStale = (
  state: MediaState,
  live: LiveConnection,
  cause: 'transient' | 'definite',
  { atMs, policy }: StepContext,
): {
  state: MediaState;
  live: LiveConnection;
  effects: readonly PlannedEffect[];
} => {
  if (cause === 'definite')
    return {
      state,
      live: withFreshness(live, { status: 'stale', cause }),
      effects: [cancel('recovery')],
    };
  const armed = armRecovery(state.recovery, atMs, policy);
  return {
    state: { ...state, recovery: armed.recovery },
    live: withFreshness(live, {
      status: 'stale',
      cause,
      wakeArmed: armed.effects.length > 0,
    }),
    effects: armed.effects,
  };
};

export const reduceReadFailed = (
  state: MediaState,
  live: LiveConnection,
  flight: ReadFlight,
  failure: RequestFailure,
  ctx: StepContext,
): Decision => {
  if (flight.generation !== state.intent.generation)
    return leaveFlight(state, live, ctx.atMs);
  const pause = ctx.policy.requestRetryDelaysMs[flight.attempt];
  if (failure === 'transient' && pause !== undefined) {
    const { establishment } = live;
    return {
      state: withLive(state, {
        ...live,
        establishment:
          establishment.stage === 'establishing'
            ? { stage: 'establishing', reconnecting: true }
            : establishment,
        reads: {
          ...live.reads,
          flight: { ...flight, stage: 'pausing', attempt: flight.attempt + 1 },
        },
      }),
      effects: [schedule('read-retry', pause)],
    };
  }
  if (
    failure === 'refused' ||
    failure === 'ending' ||
    live.establishment.stage === 'establishing'
  )
    return release(state, whyOf(failure), ctx);
  const stale = showStale(
    state,
    clearFlight(live),
    failure === 'transient' ? 'transient' : 'definite',
    ctx,
  );
  return prepend(
    stale.effects,
    startNextRead(stale.state, stale.live, ctx.atMs),
  );
};

export const reduceReadAborted = (
  state: MediaState,
  live: LiveConnection,
  ctx: StepContext,
): Decision => leaveFlight(state, live, ctx.atMs);

/** The pause between attempts ended: the same ticket tries again. */
export const retryRead = (
  state: MediaState,
  live: LiveConnection,
  flight: ReadFlight,
): Decision => {
  return {
    state: withLive(state, {
      ...live,
      reads: { ...live.reads, flight: { ...flight, stage: 'requesting' } },
    }),
    effects: [{ type: 'start-read', ticket: flight.ticket }],
  };
};
