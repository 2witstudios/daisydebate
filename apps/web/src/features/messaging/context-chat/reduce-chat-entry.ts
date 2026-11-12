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
  const empty = checking(state, event.request);
  if (empty) return openingChecked(state, empty, event.channel);
  const loading = entering(state, event.request);
  if (loading?.step !== 'discovering') return rejected(state);
  if (event.channel) return open(state, event.channel);
  const { request, kept } = loading;
  return loading.mayOpen
    ? stand(state, { kind: 'loading', request, step: 'opening', kept }, [
        { type: 'open', request },
      ])
    : stand(state, { kind: 'empty', kept, checking: null });
};

/** The empty chat whose check this request is, if it still waits for it. */
const checking = (state: ContextChatState, request: number) =>
  state.standing.kind === 'empty' && state.standing.checking === request
    ? state.standing
    : null;

/**
 * A reader who may not open the chat asks, quietly, whether someone else has:
 * the chat stays empty while the answer is on its way, and one check waits at
 * a time.
 */
export const checkOpening = (state: ContextChatState): ContextChatStep => {
  const { standing } = state;
  if (standing.kind !== 'empty' || standing.checking !== null)
    return rejected(state);
  const request = state.requests + 1;
  return {
    state: { requests: request, standing: { ...standing, checking: request } },
    effects: [{ type: 'discover', request }],
  };
};

/** Found: the chat opens as if entered. Still none: it stays empty for the next check. */
const openingChecked = (
  state: ContextChatState,
  empty: Extract<ContextChatState['standing'], { readonly kind: 'empty' }>,
  channel: ContextChatMetadata | null,
) =>
  channel ? open(state, channel) : stand(state, { ...empty, checking: null });

export const opened = (state: ContextChatState, event: Event<'opened'>) =>
  entering(state, event.request)?.step === 'opening'
    ? open(state, event.metadata)
    : rejected(state);

export const entryRefused = (
  state: ContextChatState,
  event: Event<'entry-refused'>,
) => {
  const empty = checking(state, event.request);
  // Refused access ends the checks; a failed check is simply asked again later.
  if (empty)
    return stand(
      state,
      event.denied
        ? { kind: 'denied', kept: empty.kept }
        : { ...empty, checking: null },
    );
  const loading = entering(state, event.request);
  return loading
    ? stand(state, {
        kind: event.denied ? 'denied' : 'unavailable',
        kept: loading.kept,
      })
    : rejected(state);
};
