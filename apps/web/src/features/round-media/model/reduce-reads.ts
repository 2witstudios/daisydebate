import { decideMediaRead, decideSupersededRead } from '../media-read-intent';
import type { MediaReadEvent } from '../media-read-intent';
import type { RoundMediaState } from '@daisy/protocol';
import type { MediaEffect } from './media-effects';
import type { MediaEvent, RequestFailure } from './media-events';
import type {
  Freshness,
  LiveConnection,
  MediaPolicy,
  MediaState,
} from './media-state';
import { SOURCES } from './media-state';
import {
  finish,
  join,
  release,
  unchanged,
  whyOf,
  withLive,
  type Context,
  type MediaStep,
} from './media-transitions';
import {
  armRecovery,
  clearOfEventFloor,
  disarmRecovery,
} from './recovery-pace';
import { convergeSources, desiredSources, isOccupied } from './reduce-sources';

/** Starts the queued read unless the current answer is still being applied. */
export const startNextRead = (
  state: MediaState,
  live: LiveConnection,
  atMs: number,
): MediaStep => {
  const running = live.apply.running;
  const blocked =
    running !== null && running.generation === state.intent.generation;
  if (live.reads.flight || !live.reads.queued || blocked)
    return { state: withLive(state, live), effects: [] };
  const ticket = state.nextTicket;
  return {
    state: {
      ...state,
      nextTicket: ticket + 1,
      link: {
        ...live,
        reads: {
          ...live.reads,
          queued: false,
          flight: {
            ticket,
            generation: state.intent.generation,
            attempt: 0,
            stage: 'requesting',
            startedAtMs: atMs,
            letFinishing: false,
          },
        },
      },
    },
    effects: [{ type: 'start-read', ticket }],
  };
};

export const startBudget = (
  live: LiveConnection,
  policy: MediaPolicy,
): { live: LiveConnection; effects: readonly MediaEffect[] } =>
  live.reads.budgetRunning
    ? { live, effects: [] }
    : {
        live: { ...live, reads: { ...live.reads, budgetRunning: true } },
        effects: [
          { type: 'schedule', timer: 'read-budget', ms: policy.readBudgetMs },
        ],
      };

const beginApply = (
  state: MediaState,
  live: LiveConnection,
  pending: { readonly generation: number; readonly answer: RoundMediaState },
  ctx: Context,
): MediaStep => {
  const previouslyDesired = desiredSources(live);
  const updated: LiveConnection = {
    ...live,
    grants: pending.answer.grants.publish,
    apply: {
      running: { ...pending, patienceExpired: false },
      next: null,
    },
  };
  const converged = convergeSources(updated, previouslyDesired, ctx.atMs);
  const capturing = SOURCES.some(
    (name) => converged.live.sources[name].phase === 'capturing',
  );
  const settled = settleApply(state, converged.live, ctx);
  return {
    state: settled.state,
    effects: [
      ...converged.effects,
      ...(capturing && settled.state.link === converged.live
        ? [
            {
              type: 'schedule',
              timer: 'capture-patience',
              ms: ctx.policy.capturePatienceMs,
            } as const,
          ]
        : []),
      ...settled.effects,
    ],
  };
};

/** The answer applies once no source is working, or only prompts past patience are. */
export const settleApply = (
  state: MediaState,
  live: LiveConnection,
  ctx: Context,
): MediaStep => {
  const running = live.apply.running;
  if (!running) return startNextRead(state, live, ctx.atMs);
  const busy = SOURCES.some((name) =>
    isOccupied(live.sources[name], running.patienceExpired),
  );
  if (busy) return { state: withLive(state, live), effects: [] };
  const effects: MediaEffect[] = [
    { type: 'cancel', timer: 'capture-patience' },
  ];
  const current = running.generation === state.intent.generation;
  let next: LiveConnection = {
    ...live,
    apply: { running: null, next: live.apply.next },
  };
  let recovery = state.recovery;
  if (current) {
    if (next.reads.budgetRunning)
      effects.push({ type: 'cancel', timer: 'read-budget' });
    next = {
      ...next,
      established: true,
      media: running.answer,
      freshness: 'current',
      reads: { ...next.reads, budgetRunning: false, supersededSinceAnswer: 0 },
    };
    const disarmed = disarmRecovery(recovery);
    recovery = {
      ...disarmed.recovery,
      heldSinceMs: recovery.heldSinceMs ?? ctx.atMs,
    };
    effects.push(...disarmed.effects);
  }
  const base = { ...state, recovery };
  const pending = next.apply.next;
  // A supersession already dropped any older answer waiting here.
  if (pending) {
    const applied = beginApply(base, next, pending, ctx);
    return {
      state: applied.state,
      effects: [...effects, ...applied.effects],
    };
  }
  const started = startNextRead(
    base,
    { ...next, apply: { running: null, next: null } },
    ctx.atMs,
  );
  return { state: started.state, effects: [...effects, ...started.effects] };
};

export const queueRead = (live: LiveConnection): LiveConnection =>
  live.reads.queued
    ? live
    : { ...live, reads: { ...live.reads, queued: true } };

/** Asks for a read at the end of this burst of events, so it costs one. */
export const requestRead = (
  state: MediaState,
  live: LiveConnection,
): MediaStep => {
  const queued = queueRead(live);
  if (queued.reads.flight || queued.reads.startDeferred)
    return {
      state: queued === state.link ? state : withLive(state, queued),
      effects: [],
    };
  return {
    state: withLive(state, {
      ...queued,
      reads: { ...queued.reads, startDeferred: true },
    }),
    effects: [{ type: 'defer-read-start' }],
  };
};

/** The answer is overdue or unobtainable: live tracks stay, and it is said plainly. */
const showStale = (
  state: MediaState,
  live: LiveConnection,
  kind: 'transient' | 'definite',
  { atMs, policy }: Context,
): {
  state: MediaState;
  live: LiveConnection;
  effects: readonly MediaEffect[];
} => {
  const freshness: Freshness = { stale: kind };
  const next = { ...live, freshness };
  if (kind === 'definite') {
    const disarmed = disarmRecovery(state.recovery);
    return {
      state: { ...state, recovery: disarmed.recovery },
      live: next,
      effects: disarmed.effects,
    };
  }
  const armed = armRecovery(state.recovery, 'wake', atMs, policy);
  return {
    state: { ...state, recovery: armed.recovery },
    live: next,
    effects: armed.effects,
  };
};

export const reduceRead = (
  state: MediaState,
  read: MediaReadEvent,
  ctx: Context,
): MediaStep => {
  const decision = decideMediaRead(state.intent, read);
  if (decision.action === 'ignore') return unchanged(state);
  const next = { ...state, intent: decision.intent };
  const live = state.link.phase === 'live' ? state.link : null;
  if (!live)
    return decision.action === 'wake' ? unchanged(state) : unchanged(next);
  if (decision.action === 'wake') return requestRead(next, live);
  // Superseded: the old ticket is invalid before its abort, and its reply is fenced.
  const effects: MediaEffect[] = [];
  let flight = live.reads.flight;
  if (flight) {
    const pacing = decideSupersededRead({
      supersededSinceAnswer: live.reads.supersededSinceAnswer,
      readAgeMs: ctx.atMs - flight.startedAtMs,
    });
    if (flight.stage === 'pausing') {
      effects.push({ type: 'cancel', timer: 'read-retry' });
      flight = null;
    } else if (pacing === 'abort') {
      effects.push({ type: 'abort-read', ticket: flight.ticket });
    } else if (!flight.letFinishing) {
      flight = { ...flight, letFinishing: true };
      effects.push({
        type: 'schedule',
        timer: 'read-let-finish',
        ms: Math.max(
          0,
          ctx.policy.letFinishMs - (ctx.atMs - flight.startedAtMs),
        ),
      });
    }
  }
  const budgeted = startBudget(
    {
      ...live,
      freshness: live.freshness === 'current' ? 'checking' : live.freshness,
      reads: {
        ...live.reads,
        flight,
        queued: true,
        supersededSinceAnswer: live.reads.supersededSinceAnswer + 1,
      },
      // An older answer waiting to apply may no longer start.
      apply: { ...live.apply, next: null },
    },
    ctx.policy,
  );
  const requested = requestRead(next, budgeted.live);
  return {
    state: requested.state,
    effects: [...effects, ...budgeted.effects, ...requested.effects],
  };
};

export const clearFlight = (live: LiveConnection): LiveConnection => ({
  ...live,
  reads: { ...live.reads, flight: null },
});

export const letFinishCancel = (
  live: LiveConnection,
): readonly MediaEffect[] =>
  live.reads.flight?.letFinishing
    ? [{ type: 'cancel', timer: 'read-let-finish' }]
    : [];

export const reduceAnswered = (
  state: MediaState,
  live: LiveConnection,
  answer: RoundMediaState,
  ctx: Context,
): MediaStep => {
  const flight = live.reads.flight!;
  const effects = letFinishCancel(live);
  const cleared = clearFlight(live);
  if (flight.generation !== state.intent.generation) {
    const started = startNextRead(state, cleared, ctx.atMs);
    return { state: started.state, effects: [...effects, ...started.effects] };
  }
  if (answer.state === 'ended') return finish(state, []);
  if (answer.state !== 'ready') return release(state, 'definite', ctx);
  const pending = { generation: flight.generation, answer };
  if (cleared.apply.running) {
    const queued: LiveConnection = {
      ...cleared,
      apply: { ...cleared.apply, next: pending },
    };
    const started = startNextRead(state, queued, ctx.atMs);
    return { state: started.state, effects: [...effects, ...started.effects] };
  }
  const applied = beginApply(state, cleared, pending, ctx);
  return { state: applied.state, effects: [...effects, ...applied.effects] };
};

export const reduceFailed = (
  state: MediaState,
  live: LiveConnection,
  failure: RequestFailure,
  ctx: Context,
): MediaStep => {
  const flight = live.reads.flight!;
  const delays = ctx.policy.requestRetryDelaysMs;
  if (flight.generation !== state.intent.generation) {
    const started = startNextRead(state, clearFlight(live), ctx.atMs);
    return {
      state: started.state,
      effects: [...letFinishCancel(live), ...started.effects],
    };
  }
  const pause = delays[flight.attempt];
  if (failure === 'transient' && pause !== undefined)
    return {
      state: withLive(state, {
        ...live,
        reconnecting: live.established ? live.reconnecting : true,
        reads: {
          ...live.reads,
          flight: { ...flight, stage: 'pausing', attempt: flight.attempt + 1 },
        },
      }),
      effects: [{ type: 'schedule', timer: 'read-retry', ms: pause }],
    };
  if (failure === 'refused' || failure === 'ending' || !live.established)
    return release(state, whyOf(failure), ctx);
  const stale = showStale(
    state,
    { ...clearFlight(live), freshness: live.freshness },
    failure === 'transient' ? 'transient' : 'definite',
    ctx,
  );
  const started = startNextRead(stale.state, stale.live, ctx.atMs);
  return {
    state: started.state,
    effects: [...stale.effects, ...started.effects],
  };
};

export const reduceTimer = (
  state: MediaState,
  timer: MediaEvent & { type: 'timer-fired' },
  ctx: Context,
): MediaStep => {
  const link = state.link;
  switch (timer.timer) {
    case 'admission-retry':
      if (link.phase !== 'admitting' || link.stage !== 'pausing')
        return unchanged(state);
      return {
        state: { ...state, link: { ...link, stage: 'requesting' } },
        effects: [{ type: 'admit', connection: link.connection }],
      };
    case 'read-retry': {
      if (link.phase !== 'live' || link.reads.flight?.stage !== 'pausing')
        return unchanged(state);
      const flight = link.reads.flight;
      if (flight.generation !== state.intent.generation)
        return startNextRead(state, clearFlight(link), ctx.atMs);
      return {
        state: withLive(state, {
          ...link,
          reads: {
            ...link.reads,
            flight: { ...flight, stage: 'requesting' },
          },
        }),
        effects: [{ type: 'start-read', ticket: flight.ticket }],
      };
    }
    case 'read-let-finish':
      if (link.phase !== 'live' || !link.reads.flight?.letFinishing)
        return unchanged(state);
      return {
        state,
        effects: [{ type: 'abort-read', ticket: link.reads.flight.ticket }],
      };
    case 'read-budget': {
      if (link.phase !== 'live' || !link.reads.budgetRunning)
        return unchanged(state);
      const live = {
        ...link,
        reads: { ...link.reads, budgetRunning: false },
      };
      // Never live means nothing is lost by releasing a first apply that hung.
      if (!live.established) return release(state, 'transient', ctx);
      if (typeof live.freshness === 'object')
        return { state: withLive(state, live), effects: [] };
      const stale = showStale(state, live, 'transient', ctx);
      return {
        state: withLive(stale.state, stale.live),
        effects: stale.effects,
      };
    }
    case 'capture-patience': {
      if (link.phase !== 'live' || !link.apply.running) return unchanged(state);
      const sources = { ...link.sources };
      for (const name of SOURCES) {
        const source = sources[name];
        if (source.phase === 'capturing')
          sources[name] = { phase: 'capturing', waiting: true };
      }
      return settleApply(
        state,
        {
          ...link,
          sources,
          apply: {
            ...link.apply,
            running: { ...link.apply.running, patienceExpired: true },
          },
        },
        ctx,
      );
    }
    case 'recovery':
      return attemptRecovery(state, ctx);
  }
};

const attemptRecovery = (state: MediaState, ctx: Context): MediaStep => {
  const { armed } = state.recovery;
  if (armed === null) return unchanged(state);
  const recovery = {
    ...state.recovery,
    armed: null,
    lastAttemptMs: ctx.atMs,
  };
  const link = state.link;
  if (armed === 'rejoin')
    return link.phase === 'released'
      ? join({ ...state, recovery }, true, ctx.atMs, ctx.policy)
      : unchanged(state);
  if (link.phase !== 'live') return unchanged(state);
  return startNextRead({ ...state, recovery }, queueRead(link), ctx.atMs);
};

export const reduceNudge = (state: MediaState, ctx: Context): MediaStep => {
  if (!clearOfEventFloor(state.recovery, ctx.atMs, ctx.policy))
    return unchanged(state);
  if (state.recovery.armed !== null) {
    const attempted = attemptRecovery(state, ctx);
    return {
      state: attempted.state,
      effects: [{ type: 'cancel', timer: 'recovery' }, ...attempted.effects],
    };
  }
  const link = state.link;
  if (link.phase !== 'live' || !link.established) return unchanged(state);
  return startNextRead(
    {
      ...state,
      recovery: { ...state.recovery, lastAttemptMs: ctx.atMs },
    },
    queueRead(link),
    ctx.atMs,
  );
};
