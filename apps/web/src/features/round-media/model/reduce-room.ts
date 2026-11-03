import { release, whyOf } from './connection-lifecycle';
import type { PlannedEffect } from './media-step';
import type { RoomEvent } from './media-events';
import type {
  LiveConnection,
  MediaState,
  Source,
  SourceState,
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
import { settleApply } from './reduce-apply';
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
  ctx: StepContext,
): Decision => {
  const link = state.link;
  if (link.phase !== 'connecting' || link.connection !== event.connection)
    return rejected(state);
  const live: LiveConnection = {
    phase: 'live',
    connection: link.connection,
    identity: link.identity,
    room: link.room,
    establishment: { stage: 'establishing', reconnecting: link.reconnecting },
    grants: [],
    permission: event.permission,
    sources: emptySources,
    tracks: [],
    peers: [],
    sound: 'allowed',
    changingMicrophone: false,
    transport: 'steady',
    reads: { flight: null, next: 'wanted', supersededSinceAnswer: 0 },
    apply: null,
  };
  return prepend(
    [
      ...(link.reconnecting ? [{ type: 'refresh-view' } as const] : []),
      schedule('read-budget', ctx.policy.readBudgetMs),
    ],
    startNextRead(state, live, ctx.atMs),
  );
};

/** A source reported back: move it, then see if its answer can finish applying. */
const sourceMoved = (
  state: MediaState,
  live: LiveConnection,
  source: Source,
  next: SourceState,
  effects: readonly PlannedEffect[],
  ctx: StepContext,
): Decision => {
  const converged = convergeSources(
    { ...live, sources: { ...live.sources, [source]: next } },
    desiredSources(live),
    state.devices === 'defaults',
    ctx.atMs,
  );
  return prepend(
    [...effects, ...converged.effects],
    settleApply(state, converged.live, ctx),
  );
};

const reduceMuteFailed = (
  state: MediaState,
  live: LiveConnection,
  event: RoomEvent & { type: 'mute-failed' },
  ctx: StepContext,
): Decision => {
  const settled = { ...live, changingMicrophone: false };
  const { phase } = live.sources.microphone;
  if (phase !== 'published' && phase !== 'warm')
    return moved(withLive(state, settled));
  const { connection } = live;
  return sourceMoved(
    state,
    settled,
    'microphone',
    {
      phase: 'failed',
      kind: event.kind,
      removingSinceMs: phase === 'published' ? ctx.atMs : null,
    },
    [
      { type: 'release-track', connection, source: 'microphone' },
      ...(phase === 'published'
        ? [{ type: 'unpublish', connection, source: 'microphone' } as const]
        : []),
    ],
    ctx,
  );
};

export const reduceRoom = (
  state: MediaState,
  event: RoomEvent & { readonly connection: number },
  ctx: StepContext,
): Decision => {
  const link = state.link;
  const { connection } = event;
  if (event.type === 'connect-failed')
    return link.phase === 'connecting' && link.connection === connection
      ? release(state, whyOf(event.failure), ctx)
      : rejected(state);
  if (event.type === 'connected') return reduceConnected(state, event, ctx);
  if (link.phase !== 'live' || link.connection !== connection)
    return rejected(state);
  const report = (
    source: Source,
    next: SourceState,
    effects: readonly PlannedEffect[] = [],
  ) => sourceMoved(state, link, source, next, effects, ctx);
  switch (event.type) {
    case 'dropped':
      return prepend(
        [{ type: 'refresh-view' }],
        release(state, 'transient', ctx),
      );
    case 'replaced':
      return release(state, 'replaced', ctx);
    case 'room-changed':
      return prepend([{ type: 'refresh-view' }], requestRead(state, link));
    case 'permission-changed': {
      const converged = convergeSources(
        { ...link, permission: event.permission },
        desiredSources(link),
        state.devices === 'defaults',
        ctx.atMs,
      );
      return prepend(
        [{ type: 'refresh-view' }, ...converged.effects],
        requestRead(state, converged.live),
      );
    }
    case 'observed':
      return moved(
        withLive(state, { ...link, tracks: event.tracks, peers: event.peers }),
      );
    case 'captured': {
      if (link.sources[event.source].phase === 'missing')
        return {
          state,
          effects: [
            { type: 'release-track', connection, source: event.source },
          ],
        };
      if (link.sources[event.source].phase !== 'capturing')
        return rejected(state);
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
        return rejected(state);
      return report(
        event.source,
        event.checked && event.kind === 'absence'
          ? { phase: 'missing' }
          : { phase: 'failed', kind: event.kind, removingSinceMs: null },
      );
    case 'published':
      if (link.sources[event.source].phase !== 'publishing')
        return rejected(state);
      return report(event.source, { phase: 'published', swapped: false });
    case 'publish-failed':
      if (link.sources[event.source].phase !== 'publishing')
        return rejected(state);
      return report(
        event.source,
        { phase: 'failed', kind: event.kind, removingSinceMs: null },
        [{ type: 'release-track', connection, source: event.source }],
      );
    case 'unpublished': {
      const source = link.sources[event.source];
      if (source.phase === 'failed' && source.removingSinceMs !== null)
        return report(event.source, { ...source, removingSinceMs: null });
      if (source.phase !== 'unpublishing') return rejected(state);
      return report(
        event.source,
        source.keepWarm ? { phase: 'warm' } : { phase: 'off' },
      );
    }
    case 'unpublish-failed': {
      const source = link.sources[event.source];
      if (
        source.phase !== 'unpublishing' &&
        !(source.phase === 'failed' && source.removingSinceMs !== null)
      )
        return rejected(state);
      return report(event.source, { phase: 'stale-publication' }, [
        { type: 'release-track', connection, source: event.source },
      ]);
    }
    case 'track-ended':
      if (link.sources[event.source].phase !== 'published')
        return rejected(state);
      return report(
        event.source,
        { phase: 'failed', kind: 'absence', removingSinceMs: ctx.atMs },
        [
          { type: 'release-track', connection, source: event.source },
          { type: 'unpublish', connection, source: event.source },
        ],
      );
    case 'device-swapped':
      if (link.sources[event.source].phase !== 'published')
        return rejected(state);
      return report(event.source, { phase: 'published', swapped: true });
    case 'mute-applied':
      if (!link.changingMicrophone) return rejected(state);
      return {
        state: {
          ...withLive(state, { ...link, changingMicrophone: false }),
          microphoneMuted: event.muted,
        },
        effects: [{ type: 'remember-mute', muted: event.muted }],
      };
    case 'mute-abandoned':
      return link.changingMicrophone
        ? moved(withLive(state, { ...link, changingMicrophone: false }))
        : rejected(state);
    case 'mute-failed':
      return link.changingMicrophone
        ? reduceMuteFailed(state, link, event, ctx)
        : rejected(state);
    case 'playback-changed': {
      const sound = event.allowed ? 'allowed' : 'blocked';
      return sound === link.sound
        ? rejected(state)
        : moved(withLive(state, { ...link, sound }));
    }
    case 'transport-resuming':
      return link.transport === 'resuming'
        ? rejected(state)
        : {
            state: withLive(state, { ...link, transport: 'resuming' }),
            effects: [schedule('resume-budget', ctx.policy.resumeBudgetMs)],
          };
    case 'transport-resumed': {
      if (link.transport === 'steady') return rejected(state);
      // A grant may have moved while the signal was away: read it before trusting it.
      return prepend(
        [cancel('resume-budget'), { type: 'refresh-view' }],
        requestRead(state, { ...link, transport: 'steady' }),
      );
    }
    default: {
      const unknown: never = event;
      return unknown;
    }
  }
};
