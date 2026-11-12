import type { ContextChatEvent } from './chat-events';
import type { ContextChatState } from './chat-state';
import { rejected, stand, type Event, type ContextChatStep } from './chat-step';
import {
  checkOpening,
  discovered,
  enter,
  entryRefused,
  opened,
} from './reduce-chat-entry';
import {
  askLatest,
  askOlder,
  latestRead,
  olderRead,
  readRefused,
  refresh,
} from './reduce-chat-reads';

const hide = (state: ContextChatState): ContextChatStep => {
  const chat = state.standing;
  if (chat.kind !== 'ready' || chat.hidden) return rejected(state);
  const { thread } = chat;
  return stand(state, {
    ...chat,
    hidden: true,
    marking: null,
    // Whatever was asked under the access that is gone may not answer.
    reads: { latest: [], older: [] },
    // Older text was read under that access too; it needs a fresh protected read.
    thread: thread && { ...thread, older: null, paging: null },
  });
};

/** Being shown again asks for the latest page afresh: hiding dropped whatever was on its way. */
const show = (state: ContextChatState): ContextChatStep => {
  const chat = state.standing;
  return chat.kind === 'ready' && chat.hidden
    ? askLatest(state, { ...chat, hidden: false })
    : rejected(state);
};

const messagesShown = (
  state: ContextChatState,
  event: Event<'messages-shown'>,
): ContextChatStep => {
  const chat = state.standing;
  if (
    chat.kind !== 'ready' ||
    chat.hidden ||
    event.sequence <= chat.readSequence ||
    chat.marking?.sequence === event.sequence
  )
    return rejected(state);
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: { ...chat, marking: { request, sequence: event.sequence } },
    },
    effects: [
      {
        type: 'mark-read',
        request,
        channelId: chat.metadata.channelId,
        sequence: event.sequence,
      },
    ],
  };
};

const marking = (state: ContextChatState, request: number) =>
  state.standing.kind === 'ready' && state.standing.marking?.request === request
    ? { chat: state.standing, asked: state.standing.marking.sequence }
    : null;

const readMarked = (state: ContextChatState, event: Event<'read-marked'>) => {
  const mark = marking(state, event.request);
  if (!mark) return rejected(state);
  const believable =
    Number.isSafeInteger(event.sequence) &&
    event.sequence >= 0 &&
    event.sequence <= mark.asked;
  return stand(state, {
    ...mark.chat,
    marking: null,
    readSequence: believable
      ? Math.max(mark.chat.readSequence, event.sequence)
      : mark.chat.readSequence,
  });
};

/** A failed read marker never claims the messages were read. */
const readMarkFailed = (state: ContextChatState, request: number) => {
  const mark = marking(state, request);
  return mark ? stand(state, { ...mark.chat, marking: null }) : rejected(state);
};

const expire = (state: ContextChatState, event: Event<'expiry-reached'>) => {
  const chat = state.standing;
  return chat.kind === 'ready' &&
    !chat.expired &&
    chat.metadata.expiresAt === event.expiresAt
    ? stand(state, { ...chat, expired: true })
    : rejected(state);
};

/** One context chat: every event in every standing, decided from its inputs alone. */
export function reduceContextChat(
  state: ContextChatState,
  event: ContextChatEvent,
): ContextChatStep {
  switch (event.type) {
    case 'enter-requested':
      return enter(state, event);
    case 'discovered':
      return discovered(state, event);
    case 'opened':
      return opened(state, event);
    case 'entry-refused':
      return entryRefused(state, event);
    case 'opening-check-requested':
      return checkOpening(state);
    case 'refresh-requested':
      return refresh(state);
    case 'older-requested':
      return askOlder(state, event);
    case 'latest-read':
      return latestRead(state, event);
    case 'older-read':
      return olderRead(state, event);
    case 'read-refused':
      return readRefused(state, event);
    case 'chat-hidden':
      return hide(state);
    case 'chat-shown':
      return show(state);
    case 'messages-shown':
      return messagesShown(state, event);
    case 'read-marked':
      return readMarked(state, event);
    case 'read-mark-failed':
      return readMarkFailed(state, event.request);
    case 'expiry-reached':
      return expire(state, event);
  }
}
