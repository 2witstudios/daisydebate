import type { MediaEffect } from './media-effects';
import type { MediaEvent } from './media-events';
import type { MediaState, Source, SourceState } from './media-state';
import { SOURCES } from './media-state';
import {
  finish,
  join,
  release,
  teardownEffects,
  unchanged,
  whyOf,
  withLive,
  type Context,
  type MediaStep,
} from './media-transitions';
import {
  clearFlight,
  letFinishCancel,
  queueRead,
  reduceAnswered,
  reduceFailed,
  reduceNudge,
  reduceRead,
  reduceTimer,
  startNextRead,
} from './reduce-reads';
import { reduceRoom } from './reduce-room';
import {
  convergeSources,
  desiredSources,
  hasStuckWork,
} from './reduce-sources';

const reduceRetry = (state: MediaState, ctx: Context): MediaStep => {
  const link = state.link;
  if (link.phase === 'released') {
    if (link.why === 'refused') return unchanged(state);
    const joined = join(state, true, ctx.atMs, ctx.policy);
    return {
      state: joined.state,
      effects: [{ type: 'refresh-view' }, ...joined.effects],
    };
  }
  if (link.phase !== 'live') return unchanged(state);
  const effects: MediaEffect[] = [{ type: 'refresh-view' }];
  const forgotten: Source[] = [];
  let useDefaults = false;
  const sources: Record<Source, SourceState> = { ...link.sources };
  for (const name of SOURCES) {
    const source = sources[name];
    if (source.phase === 'missing') forgotten.push(name);
    if (source.phase === 'published' && source.swapped) {
      forgotten.push(name);
      sources[name] = { phase: 'published', swapped: false };
    }
    if (
      source.phase === 'failed' &&
      (source.kind === 'preference-unreadable' ||
        source.kind === 'preference-invalid')
    )
      useDefaults = true;
    if (
      source.phase === 'failed' ||
      source.phase === 'missing' ||
      source.phase === 'stale-publication'
    )
      sources[name] = { phase: 'off' };
  }
  if (useDefaults) effects.push({ type: 'use-default-devices' });
  if (forgotten.length > 0)
    effects.push({ type: 'forget-checked-devices', sources: forgotten });
  if (
    !link.established ||
    hasStuckWork(link, ctx.atMs, ctx.policy.readBudgetMs)
  ) {
    const torn = teardownEffects(link);
    const joined = join(state, true, ctx.atMs, ctx.policy);
    return {
      state: joined.state,
      effects: [...effects, ...torn, ...joined.effects],
    };
  }
  const desired = desiredSources(link);
  const converged = convergeSources({ ...link, sources }, desired, ctx.atMs);
  const started = startNextRead(state, queueRead(converged.live), ctx.atMs);
  return {
    state: started.state,
    effects: [...effects, ...converged.effects, ...started.effects],
  };
};

const reduceAdmission = (
  state: MediaState,
  event: MediaEvent & { type: 'admission-answered' | 'admission-failed' },
  ctx: Context,
): MediaStep => {
  const link = state.link;
  if (link.phase !== 'admitting' || link.connection !== event.connection)
    return unchanged(state);
  if (event.type === 'admission-answered')
    return {
      state: {
        ...state,
        link: {
          phase: 'connecting',
          connection: link.connection,
          identity: event.admission.identity,
          reconnecting: link.reconnecting,
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
  const pause = ctx.policy.requestRetryDelaysMs[link.attempt];
  if (event.failure === 'transient' && link.retries && pause !== undefined)
    return {
      state: {
        ...state,
        link: {
          ...link,
          reconnecting: true,
          attempt: link.attempt + 1,
          stage: 'pausing',
        },
      },
      effects: [{ type: 'schedule', timer: 'admission-retry', ms: pause }],
    };
  return release(state, whyOf(event.failure), ctx);
};

/**
 * The whole media state machine. Total and pure: time and policy are inputs, every
 * effect is data, and a rejected event returns this same state object.
 */
export function reduceMedia(
  state: MediaState,
  event: MediaEvent,
  ctx: Context,
): MediaStep {
  const link = state.link;
  if (link.phase === 'ended') return unchanged(state);
  switch (event.type) {
    case 'tab-changed':
      if (event.owns === true)
        return link.phase === 'waiting'
          ? join(state, false, ctx.atMs, ctx.policy)
          : unchanged(state);
      {
        const tab = event.owns === false ? 'elsewhere' : 'checking';
        if (link.phase === 'waiting' && link.tab === tab)
          return unchanged(state);
        return {
          state: {
            ...state,
            link: { phase: 'waiting', tab },
            recovery: { ...state.recovery, armed: null },
          },
          effects: teardownEffects(link),
        };
      }
    case 'page-left':
      return finish(state, []);
    case 'round-ended':
      return finish(state, [{ type: 'forget-mute' }]);
    case 'frozen-page-restored': {
      const read = reduceRead(state, { kind: 'wake' }, ctx);
      return {
        state: read.state,
        effects: [{ type: 'refresh-view' }, ...read.effects],
      };
    }
    case 'mute-restored':
      return event.muted === state.microphoneMuted
        ? unchanged(state)
        : unchanged({ ...state, microphoneMuted: event.muted });
    case 'admission-answered':
    case 'admission-failed':
      return reduceAdmission(state, event, ctx);
    case 'read-requested':
      return reduceRead(state, event.read, ctx);
    case 'read-start-due':
      return link.phase === 'live' && link.reads.startDeferred
        ? startNextRead(
            state,
            { ...link, reads: { ...link.reads, startDeferred: false } },
            ctx.atMs,
          )
        : unchanged(state);
    case 'read-answered':
    case 'read-failed':
    case 'read-aborted': {
      if (link.phase !== 'live' || link.reads.flight?.ticket !== event.ticket)
        return unchanged(state);
      if (event.type === 'read-answered')
        return reduceAnswered(state, link, event.answer, ctx);
      if (event.type === 'read-failed')
        return reduceFailed(state, link, event.failure, ctx);
      const started = startNextRead(state, clearFlight(link), ctx.atMs);
      return {
        state: started.state,
        effects: [...letFinishCancel(link), ...started.effects],
      };
    }
    case 'timer-fired':
      return reduceTimer(state, event, ctx);
    case 'browser-nudged':
      return reduceNudge(state, ctx);
    case 'retry-pressed':
      return reduceRetry(state, ctx);
    case 'mute-requested':
      if (link.phase !== 'live' || state.changingMicrophone)
        return unchanged(state);
      return {
        state: { ...state, changingMicrophone: true },
        effects: [
          {
            type: 'set-mute',
            connection: link.connection,
            muted: event.muted,
          },
        ],
      };
    case 'enable-sound-pressed':
      return link.phase === 'live'
        ? {
            state,
            effects: [{ type: 'start-audio', connection: link.connection }],
          }
        : unchanged(state);
    case 'forget-failed': {
      if (link.phase !== 'live') return unchanged(state);
      const sources = { ...link.sources };
      for (const name of event.sources)
        sources[name] =
          sources[name].phase === 'published'
            ? { phase: 'published', swapped: true }
            : { phase: 'missing' };
      return unchanged(withLive(state, { ...link, sources }));
    }
    default:
      return reduceRoom(state, event, ctx);
  }
}
