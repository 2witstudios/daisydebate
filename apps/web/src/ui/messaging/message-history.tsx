'use client';
import { useCallback, useMemo, useState } from 'react';
import { ConversationLink as Link } from './conversation-navigation';
import type { MessagingConversation } from '../../features/messaging/conversation';
import {
  knownFirstUnread,
  messageRows,
  unreadPlacement,
  type UnreadBoundary,
} from '../../features/messaging/message-rows';
import { MessageRow } from './message-row';
import type { ReactionPillAction } from './reaction-pill';
import { useHistoryScroll } from './history-scroll';
import { useReaderTimeZone } from './time-zone';

export type MessagingViewer = {
  readonly readSequence: number;
  readonly firstUnreadSequence: number | null;
  readonly ownReactions: readonly {
    readonly messageId: string;
    readonly reactions: readonly string[];
  }[];
};
function Separator({ label }: { readonly label: string }) {
  return (
    <div className="flex items-center gap-3 px-6 pt-3 pb-1 text-xs font-semibold text-ink-muted max-narrow:px-4">
      <span className="flex-1 border-t border-border" />
      {label}
      <span className="flex-1 border-t border-border" />
    </div>
  );
}

function UnreadDivider() {
  return (
    <div
      id="first-unread"
      className="flex items-center gap-2 px-6 pt-2 text-badge font-heavy tracking-wider text-accent uppercase max-narrow:px-4"
    >
      <span className="flex-1 border-t border-accent" />
      New
    </div>
  );
}

/** The reader's own marks, seeded by an HTTP read and kept by their own actions. */
function useOwnReactions(viewer: MessagingViewer | undefined) {
  const seeded = useMemo(
    () =>
      new Map(
        (viewer?.ownReactions ?? []).map((item) => [
          item.messageId,
          item.reactions,
        ]),
      ),
    [viewer?.ownReactions],
  );
  const [own, setOwn] =
    useState<ReadonlyMap<string, readonly string[]>>(seeded);
  const [seen, setSeen] = useState(seeded);
  // A fresher HTTP read replaces the marks; a snapshot never carries any.
  if (seen !== seeded) {
    setSeen(seeded);
    setOwn(seeded);
  }
  const reacted = useCallback(
    (messageId: string, reaction: string, mark: boolean) =>
      setOwn((current) => {
        const held = current.get(messageId) ?? [];
        const next = mark
          ? [...new Set([...held, reaction])]
          : held.filter((item) => item !== reaction);
        return new Map(current).set(messageId, next);
      }),
    [],
  );
  return [own, reacted] as const;
}

/**
 * The conversation as flat rows. Live snapshots replace what is drawn, while
 * the reader's own state stays here: where unread began when they opened it,
 * which survives marking it read, and which reactions are theirs.
 */
export function MessageHistory({
  history,
  actorId,
  searchQuery,
  otherAuthor = 'Member',
  viewer,
  now,
  filesAvailable = false,
  reactAction,
  latestLink = false,
}: {
  readonly searchQuery?: string;
  readonly history: MessagingConversation;
  readonly actorId: string | null;
  /** Who wrote messages that are not the reader's: a DM's @username (ISSUE-605). */
  readonly otherAuthor?: string;
  readonly viewer?: MessagingViewer;
  /** The server's instant, so both renders name the same days. */
  readonly now: string;
  readonly filesAvailable?: boolean;
  readonly reactAction?: ReactionPillAction;
  /** An older page offers the way back to the live one. */
  readonly latestLink?: boolean;
}) {
  const timeZone = useReaderTimeZone();
  // The reader's place as they opened this: marking read never moves it.
  const [opened, setOpened] = useState<UnreadBoundary | null>(() =>
    viewer
      ? {
          readSequence: viewer.readSequence,
          firstUnreadSequence: viewer.firstUnreadSequence,
        }
      : null,
  );
  const boundary = searchQuery === undefined ? opened : null;
  const known =
    boundary === null
      ? null
      : knownFirstUnread(boundary, history.messages, actorId);
  if (boundary !== null && known !== boundary.firstUnreadSequence)
    setOpened({ ...boundary, firstUnreadSequence: known });
  const { dividerSequence, jumpToSequence } = useMemo(
    () =>
      boundary === null
        ? { dividerSequence: null, jumpToSequence: null }
        : unreadPlacement(
            { readSequence: boundary.readSequence, firstUnreadSequence: known },
            history.messages,
            actorId,
          ),
    [boundary?.readSequence, known, history.messages, actorId],
  );
  const [own, reacted] = useOwnReactions(viewer);
  const rows = useMemo(
    () =>
      messageRows({
        messages: history.messages,
        actorId,
        otherAuthor,
        firstUnreadSequence: dividerSequence,
        now,
        timeZone,
      }),
    [history.messages, actorId, otherAuthor, dividerSequence, now, timeZone],
  );
  const { ref: historyRef, capture: captureScroll } = useHistoryScroll(rows);
  const channelId = history.channelId;
  return (
    <div
      ref={historyRef}
      onScroll={captureScroll}
      className="message-scroller min-h-0 flex-1 overflow-y-auto"
    >
      <div className="py-4">
        <div className="flex flex-wrap justify-center gap-4 px-6 pb-2 text-sm font-semibold empty:hidden">
          {history.nextBefore ? (
            <Link
              href={`/messages/${channelId}?before=${history.nextBefore.sequence}${searchQuery === undefined ? '' : `&query=${encodeURIComponent(searchQuery)}`}`}
            >
              Earlier messages
            </Link>
          ) : null}
          {jumpToSequence !== null ? (
            // A page beginning at it. It carries the place along, because
            // showing the latest page has already moved the server's.
            <Link
              href={`/messages/${channelId}?before=${jumpToSequence + history.messages.length}&unread=${jumpToSequence}#first-unread`}
            >
              Jump to first unread
            </Link>
          ) : null}
          {latestLink ? (
            <Link href={`/messages/${channelId}`}>Latest messages</Link>
          ) : null}
        </div>
        {history.messages.length === 0 ? (
          <p className="px-6 text-ink-muted max-narrow:px-4">
            {searchQuery === undefined
              ? 'No messages yet.'
              : 'No matching messages.'}
          </p>
        ) : (
          <ol aria-label="Message history" className="list-none">
            {rows.map((row) => (
              <li
                key={row.key}
                data-message-id={
                  row.kind === 'message' ? row.message.id : undefined
                }
              >
                {row.kind === 'day' ? (
                  <Separator label={row.label} />
                ) : row.kind === 'unread' ? (
                  <UnreadDivider />
                ) : row.kind === 'unavailable' ? (
                  <p className="px-6 py-1 text-sm text-ink-muted italic max-narrow:px-4">
                    Message unavailable
                  </p>
                ) : (
                  <MessageRow
                    row={row}
                    channelId={channelId}
                    own={own.get(row.message.id) ?? []}
                    filesAvailable={filesAvailable}
                    reactAction={reactAction}
                    onReacted={reacted}
                    observed={!latestLink}
                  />
                )}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
