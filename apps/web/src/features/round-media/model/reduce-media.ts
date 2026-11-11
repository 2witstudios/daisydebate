import {
  finish,
  join,
  release,
  teardownEffects,
  whyOf,
} from './connection-lifecycle';
import type { MediaEffect, MediaTimer } from './media-effects';
import type { MediaEvent } from './media-events';
import { admissionReconnects, type MediaState } from './media-state';
import {
  moved,
  prepend,
  rejected,
  schedule,
  withLive,
  withoutTimer,
  type Decision,
  type StepContext,
} from './media-step';
import { startNextRead } from './read-start';
import { patienceExpired } from './reduce-apply';
import {
  reduceReadAborted,
  reduceReadAnswered,
  reduceReadFailed,
  reduceReadRequest,
  retryRead,
} from './reduce-reads';
import {
  attemptRecovery,
  budgetExpired,
  reduceNudge,
  reduceRetry,
} from './reduce-recovery';
import { reduceRoom } from './reduce-room';

export type MediaStep = {
  readonly state: MediaState;
  readonly effects: readonly MediaEffect[];
};

const reduceAdmission = (
  state: MediaState,
  event: MediaEvent & { type: 'admission-answered' | 'admission-failed' },
  ctx: StepContext,
): Decision => {
  const link = state.link;
  if (link.phase !== 'admitting' || link.connection !== event.connection)
    return rejected(state);
  if (event.type === 'admission-answered')
    return {
      state: {
        ...state,
        link: {
          phase: 'connecting',
          connection: link.connection,
          identity: event.admission.identity,
          mediaRoomName: event.admission.mediaRoomName,
          reconnecting: admissionReconnects(link),
        },
      },
      effects: [
        {
          type: 'connect',
          connection: link.connection,
          admission: event.admission,
        },
      ],
    };
  const pause = link.ownRetry
    ? ctx.policy.requestRetryDelaysMs[link.ownRetry.attempt]
    : undefined;
  if (event.failure === 'transient' && link.ownRetry && pause !== undefined)
    return {
      state: {
        ...state,
        link: {
          ...link,
          ownRetry: { attempt: link.ownRetry.attempt + 1, pausing: true },
        },
      },
      effects: [schedule('admission-retry', pause)],
    };
  return release(state, whyOf(event.failure), ctx);
};

const reduceTimer = (
  state: MediaState,
  timer: MediaTimer,
  ctx: StepContext,
): Decision => {
  const link = state.link;
  switch (timer) {
    case 'admission-retry':
      if (link.phase !== 'admitting' || !link.ownRetry?.pausing)
        return rejected(state);
      return {
        state: {
          ...state,
          link: { ...link, ownRetry: { ...link.ownRetry, pausing: false } },
        },
        effects: [{ type: 'admit', connection: link.connection }],
      };
    case 'read-retry':
      return link.phase === 'live' && link.reads.flight?.stage === 'pausing'
        ? retryRead(state, link, link.reads.flight)
        : rejected(state);
    case 'read-let-finish':
      if (
        link.phase !== 'live' ||
        link.reads.flight?.stage !== 'letting-finish'
      )
        return rejected(state);
      return {
        state: withLive(state, {
          ...link,
          reads: {
            ...link.reads,
            flight: { ...link.reads.flight, stage: 'aborting' },
          },
        }),
        effects: [{ type: 'abort-read', ticket: link.reads.flight.ticket }],
      };
    case 'read-budget':
      return budgetExpired(state, ctx);
    case 'resume-budget':
      // An SDK attempt can wait 15 s on a frozen node; this bar does not wait with it.
      return link.phase === 'live' && link.transport === 'resuming'
        ? prepend([{ type: 'refresh-view' }], release(state, 'transient', ctx))
        : rejected(state);
    case 'capture-patience':
      return link.phase === 'live' && link.apply
        ? patienceExpired(state, link, ctx)
        : rejected(state);
    case 'recovery':
      return attemptRecovery(state, ctx);
  }
};

const decide = (
  state: MediaState,
  event: MediaEvent,
  ctx: StepContext,
): Decision => {
  const link = state.link;
  if (link.phase === 'ended') return rejected(state);
  // eslint-disable-next-line @typescript-eslint/switch-exhaustiveness-check -- the default is every RoomEvent, which reduceRoom's parameter type proves.
  switch (event.type) {
    case 'tab-changed': {
      if (event.owns === true)
        return link.phase === 'waiting'
          ? join(state, false, ctx.atMs)
          : rejected(state);
      const tab = event.owns === false ? 'elsewhere' : 'checking';
      if (link.phase === 'waiting' && link.tab === tab) return rejected(state);
      return {
        state: { ...state, link: { phase: 'waiting', tab } },
        effects: teardownEffects(link),
      };
    }
    case 'page-left':
      return finish(state, []);
    case 'round-ended':
      return finish(state, [{ type: 'forget-mute' }]);
    case 'frozen-page-restored':
      return prepend(
        [{ type: 'refresh-view' }],
        reduceReadRequest(state, { kind: 'wake' }, ctx),
      );
    case 'mute-restored':
      return event.muted === state.microphoneMuted
        ? rejected(state)
        : moved({ ...state, microphoneMuted: event.muted });
    case 'admission-answered':
    case 'admission-failed':
      return reduceAdmission(state, event, ctx);
    case 'read-requested':
      return reduceReadRequest(state, event.read, ctx);
    case 'read-start-due':
      return link.phase === 'live' && link.reads.next === 'starting'
        ? startNextRead(
            state,
            { ...link, reads: { ...link.reads, next: 'wanted' } },
            ctx.atMs,
          )
        : rejected(state);
    case 'read-answered':
    case 'read-failed':
    case 'read-aborted': {
      if (link.phase !== 'live') return rejected(state);
      const { flight } = link.reads;
      if (flight?.ticket !== event.ticket) return rejected(state);
      if (event.type === 'read-answered')
        return reduceReadAnswered(state, link, flight, event.answer, ctx);
      if (event.type === 'read-failed')
        return reduceReadFailed(state, link, flight, event.failure, ctx);
      return reduceReadAborted(state, link, ctx);
    }
    case 'timer-fired':
      return reduceTimer(state, event.timer, ctx);
    case 'browser-nudged':
      return reduceNudge(state, ctx);
    case 'retry-pressed':
      return reduceRetry(state, ctx);
    case 'mute-requested':
      if (link.phase !== 'live' || link.changingMicrophone)
        return rejected(state);
      return {
        state: withLive(state, { ...link, changingMicrophone: true }),
        effects: [
          { type: 'set-mute', connection: link.connection, muted: event.muted },
        ],
      };
    case 'enable-sound-pressed':
      return link.phase === 'live'
        ? {
            state,
            effects: [{ type: 'start-audio', connection: link.connection }],
          }
        : rejected(state);
    case 'forget-failed': {
      if (link.phase !== 'live') return rejected(state);
      const sources = { ...link.sources };
      for (const name of event.sources)
        sources[name] =
          sources[name].phase === 'published'
            ? { phase: 'published', swapped: true }
            : { phase: 'missing' };
      return moved(withLive(state, { ...link, sources }));
    }
    default:
      return reduceRoom(state, event, ctx);
  }
};

/** Gives each schedule its identity, and tracks which one of each timer is current. */
const stampTimers = ({ state, effects }: Decision): MediaStep => {
  let { timers, nextTimer } = state;
  const stamped = effects.map((effect): MediaEffect => {
    if (effect.type === 'cancel') {
      if (timers[effect.timer] !== undefined)
        timers = withoutTimer(timers, effect.timer);
      return effect;
    }
    if (effect.type !== 'schedule') return effect;
    const id = nextTimer++;
    timers = { ...timers, [effect.timer]: id };
    return { ...effect, id };
  });
  return {
    state: timers === state.timers ? state : { ...state, timers, nextTimer },
    effects: stamped,
  };
};

/**
 * The whole media state machine. Total and pure: time and policy are inputs, every
 * effect is data, and a rejected event returns this same state object.
 */
export function reduceMedia(
  state: MediaState,
  event: MediaEvent,
  ctx: StepContext,
): MediaStep {
  if (event.type !== 'timer-fired')
    return stampTimers(decide(state, event, ctx));
  if (state.timers[event.timer] !== event.id) return { state, effects: [] };
  const timers = withoutTimer(state.timers, event.timer);
  return stampTimers(decide({ ...state, timers }, event, ctx));
}
