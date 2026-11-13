import type {
  ContextChatState,
  ContextChatThread,
  OpenContextChat,
  OutstandingReads,
  ReadKind,
} from './chat-state';
import {
  keptOf,
  rejected,
  stand,
  stopWatching,
  type Event,
  type ContextChatStep,
} from './chat-step';
import { mergeContextChatMessages } from './history';
import type { ContextChatPageRead } from './view';

/** The open chat, when a read of this kind is on its way to it under this request. */
const awaiting = (
  state: ContextChatState,
  request: number,
  kind: ReadKind,
): OpenContextChat | null =>
  state.standing.kind === 'ready' &&
  state.standing.reads[kind].includes(request)
    ? state.standing
    : null;

const asked = (
  reads: OutstandingReads,
  kind: ReadKind,
  request: number,
): OutstandingReads => ({ ...reads, [kind]: [...reads[kind], request] });

/** An applied read answers for every earlier one of its kind; later ones may still apply. */
const applied = (
  reads: OutstandingReads,
  kind: ReadKind,
  request: number,
): OutstandingReads => ({
  ...reads,
  [kind]: reads[kind].filter((earlier) => earlier > request),
});

/** A failed read answers for itself alone: an earlier one may still apply. */
const failed = (
  reads: OutstandingReads,
  kind: ReadKind,
  request: number,
): OutstandingReads => ({
  ...reads,
  [kind]: reads[kind].filter((other) => other !== request),
});

/** Asks for the chat's latest page under a request of its own. */
export const askLatest = (
  state: ContextChatState,
  chat: OpenContextChat,
): ContextChatStep => {
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: { ...chat, reads: asked(chat.reads, 'latest', request) },
    },
    effects: [
      { type: 'read-latest', request, channelId: chat.metadata.channelId },
    ],
  };
};

/** A hidden chat asks nothing under its withdrawn access: being shown again asks. */
export const refresh = (state: ContextChatState): ContextChatStep =>
  state.standing.kind === 'ready' && !state.standing.hidden
    ? askLatest(state, state.standing)
    : rejected(state);

export const askOlder = (
  state: ContextChatState,
  event: Event<'older-requested'>,
): ContextChatStep => {
  const chat = state.standing;
  if (chat.kind !== 'ready' || chat.hidden || !chat.thread)
    return rejected(state);
  const request = state.requests + 1;
  return {
    state: {
      requests: request,
      standing: {
        ...chat,
        reads: asked(chat.reads, 'older', request),
        thread: { ...chat.thread, paging: request },
      },
    },
    effects: [
      {
        type: 'read-older',
        request,
        channelId: chat.metadata.channelId,
        before: event.before,
      },
    ],
  };
};

const sameChannel = (chat: OpenContextChat, page: ContextChatPageRead) =>
  page.metadata.channelId === chat.metadata.channelId &&
  page.history.channelId === chat.metadata.channelId;

export const latestRead = (
  state: ContextChatState,
  event: Event<'latest-read'>,
) => {
  const chat = awaiting(state, event.request, 'latest');
  const { page } = event;
  if (!chat || !sameChannel(chat, page)) return rejected(state);
  const { thread } = chat;
  const expiryMoved = page.metadata.expiresAt !== chat.metadata.expiresAt;
  return stand(
    state,
    {
      ...chat,
      // What the chat is now comes from the newest read of its latest page alone.
      metadata: page.metadata,
      expired: expiryMoved ? false : chat.expired,
      notice: null,
      readSequence: Math.max(chat.readSequence, page.viewer.readSequence),
      reads: applied(chat.reads, 'latest', event.request),
      thread: {
        // A live change may already have moved the history past this read.
        history:
          thread && thread.history.changeVersion > page.history.changeVersion
            ? thread.history
            : page.history,
        authors: page.authors,
        bounds: page.bounds,
        older: thread?.older ?? null,
        paging: thread?.paging ?? null,
      },
    },
    expiryMoved
      ? [{ type: 'watch-expiry', expiresAt: page.metadata.expiresAt }]
      : [],
  );
};

/** Only the older read that Older messages waits for ends its wait. */
const answered = (
  thread: ContextChatThread,
  request: number,
): ContextChatThread =>
  thread.paging === request ? { ...thread, paging: null } : thread;

/** Every read answers the chat's whole author list, so only authors not yet known are added. */
const withUnknown = (
  known: ContextChatThread['authors'],
  read: ContextChatThread['authors'],
): ContextChatThread['authors'] => [
  ...known,
  ...read.filter(
    (author) => !known.some((other) => other.actorId === author.actorId),
  ),
];

export const olderRead = (
  state: ContextChatState,
  event: Event<'older-read'>,
) => {
  const chat = awaiting(state, event.request, 'older');
  const { page } = event;
  if (!chat?.thread || !sameChannel(chat, page)) return rejected(state);
  // Applying this read settles every older read asked before it, the awaited one included.
  const thread =
    chat.thread.paging !== null && chat.thread.paging <= event.request
      ? { ...chat.thread, paging: null }
      : chat.thread;
  const { changeVersion } = page.history;
  // An older page adds messages and authors; it never says what the chat is now.
  return stand(state, {
    ...chat,
    notice: null,
    readSequence: Math.max(chat.readSequence, page.viewer.readSequence),
    reads: applied(chat.reads, 'older', event.request),
    thread: {
      ...thread,
      authors: withUnknown(thread.authors, page.authors),
      older: {
        changeVersion,
        messages: mergeContextChatMessages(
          chat.metadata.channelId,
          thread.older?.changeVersion === changeVersion
            ? thread.older.messages
            : [],
          page.history.messages,
        ),
        before: page.history.nextBefore?.sequence ?? null,
      },
    },
  });
};

export const readRefused = (
  state: ContextChatState,
  event: Event<'read-refused'>,
) => {
  const chat = awaiting(state, event.request, event.read);
  if (!chat) return rejected(state);
  if (event.denied)
    return stand(state, { kind: 'denied', kept: keptOf(chat) }, [stopWatching]);
  return stand(state, {
    ...chat,
    notice: 'read-failed',
    reads: failed(chat.reads, event.read, event.request),
    thread: chat.thread && answered(chat.thread, event.request),
  });
};
