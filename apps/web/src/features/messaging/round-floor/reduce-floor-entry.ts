import type { FloorState } from './floor-state';
import {
  keptOf,
  rejected,
  stand,
  stopWatching,
  type Event,
  type FloorStep,
} from './floor-step';
import type { FloorMetadata } from './view';

/** A found or opened floor: nothing asked before now may answer into it. */
const open = (state: FloorState, metadata: FloorMetadata): FloorStep => {
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: {
        kind: 'ready',
        metadata,
        expired: false,
        notice: null,
        readSequence: 0,
        marking: null,
        hidden: false,
        reads: { latest: [request], older: [] },
        thread: null,
      },
    },
    effects: [
      { type: 'watch-expiry', expiresAt: metadata.expiresAt },
      { type: 'read-latest', request, channelId: metadata.channelId },
    ],
  };
};

export const enter = (
  state: FloorState,
  event: Event<'enter-requested'>,
): FloorStep => {
  const { standing } = state;
  if (standing.kind === 'loading') return rejected(state);
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: {
        kind: 'loading',
        request,
        step: 'discovering',
        mayOpen: event.mayOpen,
        kept: keptOf(standing),
      },
    },
    effects: [
      ...(standing.kind === 'ready' ? [stopWatching] : []),
      { type: 'discover', request },
    ],
  };
};

const entering = (state: FloorState, request: number) =>
  state.standing.kind === 'loading' && state.standing.request === request
    ? state.standing
    : null;

export const discovered = (state: FloorState, event: Event<'discovered'>) => {
  const loading = entering(state, event.request);
  if (loading?.step !== 'discovering') return rejected(state);
  if (event.channel) return open(state, event.channel);
  const { request, kept } = loading;
  return loading.mayOpen
    ? stand(state, { kind: 'loading', request, step: 'opening', kept }, [
        { type: 'open', request },
      ])
    : stand(state, { kind: 'empty', kept });
};

export const opened = (state: FloorState, event: Event<'opened'>) =>
  entering(state, event.request)?.step === 'opening'
    ? open(state, event.metadata)
    : rejected(state);

export const entryRefused = (
  state: FloorState,
  event: Event<'entry-refused'>,
) => {
  const loading = entering(state, event.request);
  return loading
    ? stand(state, {
        kind: event.denied ? 'denied' : 'unavailable',
        kept: loading.kept,
      })
    : rejected(state);
};
