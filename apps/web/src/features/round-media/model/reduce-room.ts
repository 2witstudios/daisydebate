import type { MediaEffect } from './media-effects';
import type { RoomEvent } from './media-events';
import type {
  LiveConnection,
  MediaState,
  Source,
  SourceState,
} from './media-state';
import {
  release,
  unchanged,
  whyOf,
  withLive,
  type Context,
  type MediaStep,
} from './media-transitions';
import {
  requestRead,
  settleApply,
  startBudget,
  startNextRead,
} from './reduce-reads';
import {
  convergeSources,
  desiredSources,
  settleCaptured,
} from './reduce-sources';

const emptySources: Readonly<Record<Source, SourceState>> = {
  camera: { phase: 'off' },
  microphone: { phase: 'off' },
};

const reduceConnected = (
  state: MediaState,
  event: RoomEvent & { type: 'connected' } & { connection: number },
  ctx: Context,
): MediaStep => {
  const link = state.link;
  if (link.phase !== 'connecting' || link.connection !== event.connection)
    return unchanged(state);
  const live: LiveConnection = {
    phase: 'live',
    connection: link.connection,
    identity: link.identity,
    reconnecting: link.reconnecting,
    established: false,
    grants: [],
    permission: event.permission,
    media: null,
    freshness: 'checking',
    sources: emptySources,
    tracks: [],
    peers: [],
    sound: 'allowed',
    reads: {
      flight: null,
      queued: true,
      startDeferred: false,
      supersededSinceAnswer: 0,
      budgetRunning: false,
    },
    apply: { running: null, next: null },
  };
  const budgeted = startBudget(live, ctx.policy);
  const started = startNextRead(state, budgeted.live, ctx.atMs);
  return {
    state: started.state,
    effects: [...budgeted.effects, ...started.effects],
  };
};

/** Work a source reported back, then whether its answer can now finish applying. */
const reduceSourceReport = (
  state: MediaState,
  live: LiveConnection,
  source: Source,
  next: SourceState,
  effects: readonly MediaEffect[],
  ctx: Context,
): MediaStep => {
  const desired = desiredSources(live);
  const updated = {
    ...live,
    sources: { ...live.sources, [source]: next },
  };
  const converged = convergeSources(updated, desired, ctx.atMs);
  const settled = settleApply(state, converged.live, ctx);
  return {
    state: settled.state,
    effects: [...effects, ...converged.effects, ...settled.effects],
  };
};

export const reduceRoom = (
  state: MediaState,
  event: RoomEvent & { readonly connection: number },
  ctx: Context,
): MediaStep => {
  const link = state.link;
  const { connection } = event;
  if (event.type === 'connect-failed')
    return link.phase === 'connecting' && link.connection === connection
      ? release(state, whyOf(event.failure), ctx)
      : unchanged(state);
  if (event.type === 'connected') return reduceConnected(state, event, ctx);
  if (link.phase !== 'live' || link.connection !== connection)
    return unchanged(state);
  const report = (
    source: Source,
    next: SourceState,
    effects: readonly MediaEffect[] = [],
  ) => reduceSourceReport(state, link, source, next, effects, ctx);
  switch (event.type) {
    case 'dropped':
      return release(state, 'transient', ctx);
    case 'replaced':
      return release(state, 'replaced', ctx);
    case 'room-changed': {
      const started = requestRead(state, link);
      return {
        state: started.state,
        effects: [{ type: 'refresh-view' }, ...started.effects],
      };
    }
    case 'permission-changed': {
      const previous = desiredSources(link);
      const converged = convergeSources(
        { ...link, permission: event.permission },
        previous,
        ctx.atMs,
      );
      const started = requestRead(state, converged.live);
      return {
        state: started.state,
        effects: [
          { type: 'refresh-view' },
          ...converged.effects,
          ...started.effects,
        ],
      };
    }
    case 'observed':
      return unchanged(
        withLive(state, { ...link, tracks: event.tracks, peers: event.peers }),
      );
    case 'captured': {
      if (link.sources[event.source].phase !== 'capturing')
        return unchanged(state);
      const step = settleCaptured({
        name: event.source,
        desired: desiredSources(link),
        connection,
        muted: state.microphoneMuted,
        atMs: ctx.atMs,
      });
      return report(event.source, step.source, step.effects);
    }
    case 'capture-failed':
      if (link.sources[event.source].phase !== 'capturing')
        return unchanged(state);
      return report(
        event.source,
        event.checked && event.kind === 'absence'
          ? { phase: 'missing' }
          : { phase: 'failed', kind: event.kind },
      );
    case 'published':
      if (link.sources[event.source].phase !== 'publishing')
        return unchanged(state);
      return report(event.source, { phase: 'published', swapped: false });
    case 'publish-failed':
      if (link.sources[event.source].phase !== 'publishing')
        return unchanged(state);
      return report(event.source, { phase: 'failed', kind: event.kind }, [
        { type: 'release-track', connection, source: event.source },
      ]);
    case 'unpublished': {
      const source = link.sources[event.source];
      if (source.phase !== 'unpublishing') return unchanged(state);
      return report(
        event.source,
        source.keepWarm ? { phase: 'warm' } : { phase: 'off' },
      );
    }
    case 'unpublish-failed':
      if (link.sources[event.source].phase !== 'unpublishing')
        return unchanged(state);
      return report(event.source, { phase: 'stale-publication' }, [
        { type: 'release-track', connection, source: event.source },
      ]);
    case 'track-ended':
      if (link.sources[event.source].phase !== 'published')
        return unchanged(state);
      return report(event.source, { phase: 'failed', kind: 'absence' }, [
        { type: 'release-track', connection, source: event.source },
        { type: 'unpublish', connection, source: event.source },
      ]);
    case 'device-swapped':
      if (link.sources[event.source].phase !== 'published')
        return unchanged(state);
      return report(event.source, { phase: 'published', swapped: true });
    case 'mute-applied':
      return {
        state: {
          ...state,
          microphoneMuted: event.muted,
          changingMicrophone: false,
        },
        effects: [{ type: 'remember-mute', muted: event.muted }],
      };
    case 'mute-abandoned':
      return unchanged({ ...state, changingMicrophone: false });
    case 'mute-failed': {
      const failing = { ...state, changingMicrophone: false };
      return reduceSourceReport(
        failing,
        link,
        'microphone',
        { phase: 'failed', kind: event.kind },
        [
          { type: 'release-track', connection, source: 'microphone' },
          { type: 'unpublish', connection, source: 'microphone' },
        ],
        ctx,
      );
    }
    case 'playback-changed': {
      const sound = event.allowed ? 'allowed' : 'blocked';
      return sound === link.sound
        ? unchanged(state)
        : unchanged(withLive(state, { ...link, sound }));
    }
  }
};
