'use client';
import { useAnswer, useDeliver } from '../edge/use-answer';
import { useResource, type Disposable } from '../edge/use-driver';
import { browserScheduler } from '../edge/browser-time';
import { browserTransport } from '../edge/browser-request';
import { contextChatPagedHistory } from './paged-history';
import { createContextChatDriver } from './chat-driver';
import type { ChatContext } from '../../features/messaging/context-chat/chat-context';
import {
  useCallback,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { channelMessages } from '../../features/messaging/channel-messages';
import { useRealtime } from '../realtime/use-realtime';
import { contextChatUnread } from '../../features/messaging/context-chat/history';
import {
  contextChatIdle,
  type ContextChatFormState,
} from '../../features/messaging/context-chat/form-state';

/** What a page hands a context chat: no authority and no content, only who is asking and how to post. */
export type ContextChatProps = {
  /** The Round or Room the chat belongs to. */
  readonly ownerId: string;
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly requestId: string;
  /**
   * Whether this reader may only read, as the page knows it now. It may change
   * while the page is open (a Room's seat change); the thread then enters again.
   */
  readonly readOnlyHint: boolean;
  /** Whether entry retries one discovery GET after the server's admission wait. */
  readonly retryDiscovery?: boolean;
  /**
   * The owner's revision as the page knows it, where the page follows one. A
   * change re-reads the latest page: what this reader may be told about its
   * authors may have changed with the owner.
   */
  readonly ownerRevision?: number | undefined;
  readonly sendAction: (
    channelId: string,
    previous: ContextChatFormState,
    form: FormData,
  ) => Promise<ContextChatFormState>;
  readonly mutateAction: (
    channelId: string,
    previous: ContextChatFormState,
    form: FormData,
  ) => Promise<ContextChatFormState>;
  readonly reportAction: (
    channelId: string,
    previous: ContextChatFormState,
    form: FormData,
  ) => Promise<ContextChatFormState>;
};
/** How an empty chat that may yet be opened by someone else is asked about again. */
export type OpeningCheck = {
  readonly everyMs: number;
  /** Runs `work` every `ms` until the returned stop is called. */
  readonly every: (work: () => void, ms: number) => () => void;
  /** Whether the reader can see the page now; a hidden page asks nothing. */
  readonly visible: () => boolean;
};
const pageOpeningCheck: OpeningCheck = {
  everyMs: 15_000,
  every: browserScheduler.every,
  visible: () => document.visibilityState === 'visible',
};
type ContextChatDriver = ReturnType<typeof createContextChatDriver>;
/** A driver's lifetime on the page: answers that arrive after it ends change nothing. */
const runDriver = (driver: ContextChatDriver): Disposable => {
  driver.start();
  return { dispose: driver.stop };
};
const NO_AUTHORS: readonly { actorId: string; label: string }[] = [];
const DEFAULT_MESSAGE_UNITS = 4000;

/** One durable chat thread; its forms stay mounted while access or the selected tab changes. */
export function useContextChat({
  context,
  active = true,
  onUnread,
  openingCheck = pageOpeningCheck,
  ...props
}: ContextChatProps & {
  readonly context: ChatContext;
  readonly active?: boolean;
  readonly onUnread?: ((count: number) => void) | undefined;
  readonly openingCheck?: OpeningCheck | undefined;
}) {
  const [driver] = useState(() =>
    createContextChatDriver(
      context,
      props.ownerId,
      props.retryDiscovery ?? false,
      browserTransport,
      browserScheduler,
    ),
  );
  const { standing: state } = useSyncExternalStore(
    driver.subscribe,
    driver.state,
    driver.state,
  );
  const { send } = driver;
  useResource(driver, runDriver);
  const chat = state.kind === 'ready' ? state : null;
  const thread = chat?.thread ?? null;
  const kept =
    state.kind === 'idle' || state.kind === 'ready' ? null : state.kept;
  const channelId = chat?.metadata.channelId ?? kept?.channelId;
  const observedChannel = channelId ?? props.ownerId;
  const descriptor = useMemo(
    () => channelMessages(observedChannel),
    [observedChannel],
  );
  const live = useRealtime(
    descriptor,
    thread?.history ?? null,
    channelId ? props.socketUrl : null,
  );
  const withdrawn = live.status === 'hidden';
  const hidden = withdrawn || !chat || chat.hidden;
  const mayOpen = !props.readOnlyHint;
  /** What the reader could do when the thread was last entered. */
  const enteredAs = useRef<boolean | null>(null);
  const enter = useCallback(() => {
    enteredAs.current = mayOpen;
    send({ type: 'enter-requested', mayOpen });
  }, [send, mayOpen]);
  const refresh = useCallback(
    () => send({ type: 'refresh-requested' }),
    [send],
  );
  const loadOlder = useCallback(
    (before: number) => send({ type: 'older-requested', before }),
    [send],
  );
  // Entry follows whether the chat is in use, its standing and the hint.
  const entry = useMemo(
    () => ({ active, standing: state.kind, mayOpen }),
    [active, state.kind, mayOpen],
  );
  useDeliver(entry, ({ active: inUse, standing }) => {
    if (inUse && standing === 'idle') enter();
  });
  // The hint is not latched: when the page learns the reader may now post, or
  // may no longer, the thread enters again under it (finding or opening the
  // chat, or giving up its composer). An entry already on its way finishes
  // first.
  useDeliver(entry, ({ active: inUse, standing, mayOpen: may }) => {
    if (
      inUse &&
      standing !== 'idle' &&
      standing !== 'loading' &&
      enteredAs.current !== null &&
      enteredAs.current !== may
    )
      enter();
  });
  useAnswer(props.ownerRevision, () => send({ type: 'refresh-requested' }));
  // A reader who may not open the chat (a judge) still sees it once someone
  // else does: while it is empty and the page is in view, ask again now and
  // then. A found chat, a refusal or leaving the page ends the asking.
  const awaitingOpening =
    active && state.kind === 'empty' && context.awaitsOpening;
  useResource(awaitingOpening ? openingCheck : null, (check) =>
    check === null
      ? null
      : {
          dispose: check.every(() => {
            if (check.visible()) send({ type: 'opening-check-requested' });
          }, check.everyMs),
        },
  );
  const held = chat?.hidden ?? null;
  const visibility = useMemo(() => ({ held, withdrawn }), [held, withdrawn]);
  useDeliver(visibility, (seen) => {
    // A chat entered again starts shown, whatever the live channel still says.
    if (seen.held !== null && seen.held !== seen.withdrawn)
      send({ type: seen.withdrawn ? 'chat-hidden' : 'chat-shown' });
  });
  const history = hidden ? null : live.body;
  const { messages, before } = history
    ? contextChatPagedHistory(history, thread?.older ?? null)
    : { messages: [], before: null };
  const readSequence = chat?.readSequence ?? 0;
  const unread = contextChatUnread(messages, readSequence, props.actorId);
  useDeliver(unread, (count) => onUnread?.(count));
  const latestSequence = history?.messages[0]?.sequence ?? 0;
  const shown = useMemo(
    () => ({ active, hidden, channelId, latestSequence, readSequence }),
    [active, hidden, channelId, latestSequence, readSequence],
  );
  useDeliver(shown, (reading) => {
    if (
      reading.active &&
      !reading.hidden &&
      reading.latestSequence > reading.readSequence
    )
      send({ type: 'messages-shown', sequence: reading.latestSequence });
  });
  const authors = thread?.authors ?? NO_AUTHORS;
  const unknownAuthor = history?.messages.some(
    (message) =>
      !('unavailable' in message) &&
      !authors.some((author) => author.actorId === message.authorActorId),
  );
  const changeVersion = history?.changeVersion;
  const authorship = useMemo(
    () => ({ unknownAuthor, channelId, hidden, changeVersion }),
    [unknownAuthor, channelId, hidden, changeVersion],
  );
  useDeliver(authorship, (read) => {
    if (read.unknownAuthor && !read.hidden) send({ type: 'refresh-requested' });
  });
  const expired = chat?.expired ?? false;
  const notice =
    chat?.notice === 'read-failed'
      ? 'Messages could not be loaded. Try again.'
      : null;
  // A found chat's own metadata decides: the page's hint is only a guess for
  // the time before the chat is found (a view cannot see every standing, such
  // as a youth debater's club staff). The server refuses a post either way.
  const locked = hidden || !chat || chat.metadata.readOnly || expired;
  const [initial] = useState(() => contextChatIdle(props.requestId));
  const pending =
    state.kind === 'idle' ||
    state.kind === 'loading' ||
    (chat !== null &&
      chat.reads.latest.length > 0 &&
      !history &&
      !notice &&
      !hidden);
  return {
    state,
    authors,
    messageUnits:
      thread?.bounds.messageUnits ??
      kept?.messageUnits ??
      DEFAULT_MESSAGE_UNITS,
    before,
    paging: thread !== null && thread.paging !== null,
    notice,
    channelId,
    live,
    hidden,
    history,
    messages,
    expired,
    locked,
    initial,
    pending,
    enter,
    loadOlder,
    refresh,
  };
}
