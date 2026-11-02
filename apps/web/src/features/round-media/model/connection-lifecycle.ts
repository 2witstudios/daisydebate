import type { PlannedEffect } from './media-step';
import type { RequestFailure } from './media-events';
import type { MediaLink, MediaState, ReleaseReason } from './media-state';
import { cancel, type Decision, type StepContext } from './media-step';
import { armRecovery } from './recovery-pace';

const CONNECTION_TIMERS = [
  'admission-retry',
  'read-retry',
  'read-budget',
  'read-let-finish',
  'capture-patience',
  'recovery',
] as const;

/** Ends whatever the link holds, as far as the world can be asked synchronously. */
export const teardownEffects = (link: MediaLink): readonly PlannedEffect[] => {
  const cancels = CONNECTION_TIMERS.map(cancel);
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
  { atMs, policy }: StepContext,
): Decision => {
  const effects = teardownEffects(state.link);
  const link: MediaLink = { phase: 'released', why };
  if (why === 'transient') {
    const armed = armRecovery(state.recovery, atMs, policy);
    return {
      state: { ...state, link, recovery: armed.recovery },
      effects: [...effects, ...armed.effects],
    };
  }
  return {
    state: { ...state, link },
    effects: [...effects, { type: 'refresh-view' }],
  };
};

export const finish = (
  state: MediaState,
  extra: readonly PlannedEffect[],
): Decision => ({
  state: {
    ...state,
    link: { phase: 'ended' },
  },
  effects: [...teardownEffects(state.link), ...extra],
});

/** Only the first join retries its own admission; later attempts are one each. */
export const join = (
  state: MediaState,
  reconnecting: boolean,
  atMs: number,
): Decision => {
  const connection = state.nextConnection;
  return {
    state: {
      ...state,
      link: {
        phase: 'admitting',
        connection,
        ownRetry: reconnecting ? null : { attempt: 0, pausing: false },
      },
      nextConnection: connection + 1,
      recovery: {
        ...state.recovery,
        lastAttemptMs: atMs,
        heldSinceMs: null,
      },
    },
    effects: [cancel('recovery'), { type: 'admit', connection }],
  };
};

export const whyOf = (failure: RequestFailure): ReleaseReason =>
  failure === 'transient'
    ? 'transient'
    : failure === 'refused'
      ? 'refused'
      : 'definite';
