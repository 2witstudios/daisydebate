import { decideMediaRead } from '../media-read-intent';
import type { MediaEffect } from './media-effects';
import type { RequestFailure } from './media-events';
import type {
  LiveConnection,
  MediaLink,
  MediaPolicy,
  MediaState,
  ReleaseReason,
} from './media-state';
import { armRecovery } from './recovery-pace';

export type MediaStep = {
  readonly state: MediaState;
  readonly effects: readonly MediaEffect[];
};
export type Context = { readonly atMs: number; readonly policy: MediaPolicy };

export const unchanged = (state: MediaState): MediaStep => ({
  state,
  effects: [],
});

const CONNECTION_TIMERS = [
  'admission-retry',
  'read-retry',
  'read-budget',
  'read-let-finish',
  'capture-patience',
  'recovery',
] as const;

/** Ends whatever the link holds, synchronously as far as the world can be asked. */
export const teardownEffects = (link: MediaLink): readonly MediaEffect[] => {
  const cancels = CONNECTION_TIMERS.map(
    (timer) => ({ type: 'cancel', timer }) as const,
  );
  switch (link.phase) {
    case 'admitting':
      return [
        ...cancels,
        { type: 'abort-admission', connection: link.connection },
      ];
    case 'connecting':
      return [
        ...cancels,
        { type: 'release-connection', connection: link.connection },
      ];
    case 'live':
      return [
        ...cancels,
        ...(link.reads.flight
          ? [{ type: 'abort-read', ticket: link.reads.flight.ticket } as const]
          : []),
        { type: 'release-connection', connection: link.connection },
      ];
    default:
      return cancels;
  }
};

export const release = (
  state: MediaState,
  why: ReleaseReason,
  { atMs, policy }: Context,
): MediaStep => {
  const effects = teardownEffects(state.link);
  const link: MediaLink = { phase: 'released', why };
  if (why === 'transient') {
    const armed = armRecovery(state.recovery, 'rejoin', atMs, policy);
    return {
      state: { ...state, link, recovery: armed.recovery },
      effects: [...effects, ...armed.effects],
    };
  }
  return {
    state: { ...state, link, recovery: { ...state.recovery, armed: null } },
    effects: [...effects, { type: 'refresh-view' }],
  };
};

export const finish = (
  state: MediaState,
  extra: readonly MediaEffect[],
): MediaStep => ({
  state: {
    ...state,
    link: { phase: 'ended' },
    intent: decideMediaRead(state.intent, { kind: 'dispose' }).intent,
    recovery: { ...state.recovery, armed: null },
  },
  effects: [...teardownEffects(state.link), ...extra],
});

/** Only the first join retries its own admission; later attempts are one each. */
export const join = (
  state: MediaState,
  reconnecting: boolean,
  atMs: number,
  policy: MediaPolicy,
): MediaStep => {
  const connection = state.nextConnection;
  return {
    state: {
      ...state,
      link: {
        phase: 'admitting',
        connection,
        reconnecting,
        attempt: 0,
        retries: !reconnecting && policy.requestRetryDelaysMs.length > 0,
        stage: 'requesting',
      },
      nextConnection: connection + 1,
      recovery: {
        ...state.recovery,
        armed: null,
        lastAttemptMs: atMs,
        heldSinceMs: null,
      },
    },
    effects: [
      { type: 'cancel', timer: 'recovery' },
      { type: 'admit', connection },
    ],
  };
};

export const withLive = (
  state: MediaState,
  live: LiveConnection,
): MediaState => ({
  ...state,
  link: live,
});

export const whyOf = (failure: RequestFailure): ReleaseReason =>
  failure === 'transient'
    ? 'transient'
    : failure === 'refused'
      ? 'refused'
      : 'definite';
