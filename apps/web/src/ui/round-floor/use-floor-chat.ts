'use client';
import { floorPagedHistory } from './paged-history';
import { createFloorDriver } from './floor-driver';
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react';
import { channelMessages } from '../../features/messaging/channel-messages';
import { useRealtime } from '../../features/realtime/use-realtime';
import { floorUnread } from '../../features/messaging/round-floor/history';
import {
  floorIdle,
  type FloorFormState,
} from '../../features/messaging/round-floor/form-state';

export type FloorChatProps = {
  readonly roundId: string;
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly requestId: string;
  readonly readOnlyHint: boolean;
  readonly sendAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
  readonly mutateAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
  readonly reportAction: (
    channelId: string,
    previous: FloorFormState,
    form: FormData,
  ) => Promise<FloorFormState>;
};
const NO_AUTHORS: readonly { actorId: string; label: string }[] = [];
const DEFAULT_MESSAGE_UNITS = 4000;

/** One durable floor thread; its forms stay mounted while access or the selected tab changes. */
export function useFloorChat({
  active = true,
  onUnread,
  ...props
}: FloorChatProps & {
  readonly active?: boolean;
  readonly onUnread?: ((count: number) => void) | undefined;
}) {
  const [driver] = useState(() => createFloorDriver(props.roundId));
  const { standing: state } = useSyncExternalStore(
    driver.subscribe,
    driver.state,
    driver.state,
  );
  const { send } = driver;
  useEffect(() => {
    driver.start();
    return driver.stop;
  }, [driver]);
  const floor = state.kind === 'ready' ? state : null;
  const thread = floor?.thread ?? null;
  const kept =
    state.kind === 'idle' || state.kind === 'ready' ? null : state.kept;
  const channelId = floor?.metadata.channelId ?? kept?.channelId;
  const live = useRealtime(
    channelMessages(channelId ?? props.roundId),
    thread?.history ?? null,
    channelId ? props.socketUrl : null,
  );
  const hidden = live.status === 'hidden' || !floor;
  const mayOpen = !props.readOnlyHint;
  const enter = useCallback(
    () => send({ type: 'enter-requested', mayOpen }),
    [send, mayOpen],
  );
  const refresh = useCallback(
    () => send({ type: 'refresh-requested' }),
    [send],
  );
  const loadOlder = useCallback(
    (before: number) => send({ type: 'older-requested', before }),
    [send],
  );
  useEffect(() => {
    if (active && state.kind === 'idle') enter();
  }, [active, state.kind, enter]);
  useEffect(() => {
    if (live.status === 'hidden') send({ type: 'floor-hidden' });
  }, [live.status, send]);
  const history = hidden ? null : live.body;
  const { messages, before } = history
    ? floorPagedHistory(history, thread?.older ?? null)
    : { messages: [], before: null };
  const readSequence = floor?.readSequence ?? 0;
  const unread = floorUnread(messages, readSequence, props.actorId);
  useEffect(() => {
    onUnread?.(unread);
  }, [onUnread, unread]);
  const latestSequence = history?.messages[0]?.sequence ?? 0;
  useEffect(() => {
    if (active && !hidden && latestSequence > readSequence)
      send({ type: 'messages-shown', sequence: latestSequence });
  }, [active, hidden, channelId, latestSequence, readSequence, send]);
  const authors = thread?.authors ?? NO_AUTHORS;
  const unknownAuthor = history?.messages.some(
    (message) =>
      !('unavailable' in message) &&
      !authors.some((author) => author.actorId === message.authorActorId),
  );
  useEffect(() => {
    if (unknownAuthor && !hidden) send({ type: 'refresh-requested' });
  }, [unknownAuthor, channelId, hidden, history?.changeVersion, send]);
  const expired = floor?.expired ?? false;
  const notice =
    floor?.notice === 'read-failed'
      ? 'Messages could not be loaded. Try again.'
      : null;
  const locked =
    hidden ||
    props.readOnlyHint ||
    !floor ||
    floor.metadata.readOnly ||
    expired;
  const [initial] = useState(() => floorIdle(props.requestId));
  const pending =
    state.kind === 'idle' ||
    state.kind === 'loading' ||
    (state.kind === 'ready' && !history && !notice && !hidden);
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
