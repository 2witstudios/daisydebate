import type { ContextChatState } from './chat-state';
import {
  keptOf,
  rejected,
  stand,
  stopWatching,
  type Event,
  type ContextChatStep,
} from './chat-step';
import type { ContextChatMetadata } from './view';

/** A found or opened chat: nothing asked before now may answer into it. */
const open = (
  state: ContextChatState,
  metadata: ContextChatMetadata,
): ContextChatStep => {
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
  state: ContextChatState,
  event: Event<'enter-requested'>,
): ContextChatStep => {
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

const entering = (state: ContextChatState, request: number) =>
  state.standing.kind === 'loading' && state.standing.request === request
    ? state.standing
    : null;

export const discovered = (
  state: ContextChatState,
  event: Event<'discovered'>,
) => {
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

export const opened = (state: ContextChatState, event: Event<'opened'>) =>
  entering(state, event.request)?.step === 'opening'
    ? open(state, event.metadata)
    : rejected(state);

export const entryRefused = (
  state: ContextChatState,
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
