'use client';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { MessagingCoreBounds } from '@daisy/protocol';
import { createBrowserTypingReader } from './typing-browser';
import { MessageHistory } from './message-history';
import { createBrowserConnectionStore } from '../../features/realtime/browser-adapters';
import { attachMessagingInboxDoorbells } from '../../features/messaging/doorbells';
import { channelMessages } from '../../features/messaging/channel-observation';
import { editVisibility } from '../../features/messaging/edit-visibility';
import {
  liveReactions,
  type ReactionCount,
} from '../../features/messaging/reaction-view';
import { ReactionForm, type ReactionFormState } from './reaction-form';
import type { FormAction } from '../form-action/form-action';
import {
  useRealtime,
  useRealtimeConnection,
} from '../realtime/realtime-provider';

function useTyping(channelId: string, refetchMs: number | null) {
  const connection = useRealtimeConnection();
  const [typing, showTyping] = useState<boolean | null>(null);
  useEffect(() => {
    if (!connection) return;
    const reader = createBrowserTypingReader(
      channelId,
      connection,
      showTyping,
      refetchMs,
    );
    return () => reader.close();
  }, [channelId, connection, refetchMs]);
  return typing === true;
}
function useChannel(
  channelId: string,
  bounds: MessagingCoreBounds,
  before: number | null,
  live = true,
) {
  const { messageUnits, pageItems } = bounds;
  const descriptor = useMemo(
    () =>
      live
        ? channelMessages(channelId, { messageUnits, pageItems }, before)
        : null,
    [channelId, messageUnits, pageItems, before, live],
  );
  return useRealtime(descriptor);
}

/** Server-rendered history until the live window arrives; then the shared
 * snapshot. Withdrawn authority hides content instead of reviving stale HTML. */
export function ConversationLive({
  channelId,
  bounds,
  before,
  live,
  actorId,
  typingRefetchMs,
  children,
}: {
  readonly channelId: string;
  readonly bounds: MessagingCoreBounds;
  readonly before: number | null;
  /** Search results are explicit bounded reads, never live variants. */
  readonly live: boolean;
  readonly actorId: string | null;
  readonly typingRefetchMs: number | null;
  readonly children: ReactNode;
}) {
  const view = useChannel(channelId, bounds, before, live);
  const typing = useTyping(channelId, typingRefetchMs);
  if (view.status === 'denied' || view.withdrawn)
    return <p role="status">Conversation unavailable.</p>;
  return (
    <>
      {view.content === null ? (
        children
      ) : (
        <MessageHistory
          actorId={actorId}
          history={{
            channelId,
            messages: view.content.messages,
            nextBefore:
              view.content.continuation === null
                ? null
                : { channelId, sequence: view.content.continuation },
          }}
        />
      )}
      {typing ? <p role="status">Someone is typing…</p> : null}
    </>
  );
}

/** The edit form stays mounted across snapshots and transient gaps so a
 * draft survives; denial or removal of the message unmounts it. */
export function MessageEditLive({
  channelId,
  messageId,
  bounds,
  before,
  children,
}: {
  readonly channelId: string;
  readonly messageId: string;
  readonly bounds: MessagingCoreBounds;
  readonly before: number | null;
  readonly children: ReactNode;
}) {
  const visibility = editVisibility(
    useChannel(channelId, bounds, before),
    messageId,
  );
  if (visibility === 'revoked')
    return <p role="status">Conversation unavailable.</p>;
  if (visibility === 'removed') return <p role="status">Message removed.</p>;
  return <>{children}</>;
}

function ReactionList({
  items,
}: {
  readonly items: readonly ReactionCount[];
}) {
  return (
    <ul aria-label="Current reactions">
      {items.map((item) => (
        <li key={item.reaction}>
          {item.reaction} · {item.count}
          {item.own ? ' · You reacted' : ''}
        </li>
      ))}
    </ul>
  );
}
/** Live counts and toggle forms for one message. Forms follow the viewer's
 * own overlay and disappear with the conversation on revocation; without
 * bounds (no live window) the authorized HTTP read is shown as-is. */
export function ReactionsLive({
  channelId,
  messageId,
  bounds,
  before,
  initial,
  forms,
  action,
}: {
  readonly channelId: string;
  readonly messageId: string;
  readonly bounds: MessagingCoreBounds | null;
  readonly before: number | null;
  readonly initial: readonly ReactionCount[];
  readonly forms: readonly { reaction: string; requestId: string }[];
  readonly action: FormAction<ReactionFormState>;
}) {
  const view = useChannel(
    channelId,
    bounds ?? { messageUnits: 1, pageItems: 1 },
    before,
    bounds !== null,
  );
  const state = liveReactions(view, messageId, initial);
  if (state.kind === 'revoked')
    return <p role="status">Conversation unavailable.</p>;
  if (state.kind === 'removed') return <p role="status">Message removed.</p>;
  const own = new Set(
    state.items.filter((item) => item.own).map((item) => item.reaction),
  );
  return (
    <>
      <ReactionList items={state.items} />
      {forms.map((form) => (
        <ReactionForm
          key={form.requestId}
          action={action}
          requestId={form.requestId}
          reaction={form.reaction}
          active={!own.has(form.reaction)}
        />
      ))}
    </>
  );
}

export function InboxLive({
  actorId,
  socketUrl,
  snapshotId,
  children,
}: {
  readonly actorId: string;
  readonly socketUrl: string | null;
  readonly snapshotId: string;
  readonly children: ReactNode;
}) {
  const router = useRouter();
  const [invalidated, invalidate] = useState<string | null>(null);
  const currentSnapshot = useRef(snapshotId);
  const reader = useRef<ReturnType<
    typeof attachMessagingInboxDoorbells
  > | null>(null);
  useEffect(() => {
    currentSnapshot.current = snapshotId;
    reader.current?.authorizedSnapshot();
  }, [snapshotId]);
  useEffect(() => {
    if (socketUrl === null) return;
    const connection = createBrowserConnectionStore(socketUrl);
    const attached = attachMessagingInboxDoorbells({
      connection,
      actorId,
      invalidate: () => invalidate(currentSnapshot.current),
      refetch: () => router.refresh(),
    });
    reader.current = attached;
    const unsubscribe = connection.subscribe((state) => {
      if (state.terminal !== null) {
        invalidate(currentSnapshot.current);
        router.refresh();
      }
    });
    connection.connect();
    return () => {
      attached.close();
      unsubscribe();
      connection.dispose();
      reader.current = null;
    };
  }, [actorId, socketUrl, router]);
  return invalidated === snapshotId ? (
    <p role="status" className="text-ink-muted">
      Refreshing messages…
    </p>
  ) : (
    <>{children}</>
  );
}
