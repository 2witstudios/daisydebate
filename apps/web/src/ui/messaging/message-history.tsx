'use client';
import { useCallback, useMemo, useState } from 'react';
import { ConversationLink as Link } from './conversation-navigation';
import type { MessagingConversation } from '../../features/messaging/conversation';
import {
  earlierUnreadSequence,
  messageRows,
  type MessageRow as Row,
} from '../../features/messaging/message-rows';
import { Avatar } from '../components/avatar/avatar';
import { Icon, type IconName } from '../components/icon/icon';
import { cn } from '../cn';
import { ReactionPill, type ReactionPillAction } from './reaction-pill';
import { useReaderTimeZone } from './time-zone';

export type MessagingViewer = {
  readonly firstUnreadSequence: number | null;
  readonly ownReactions: readonly {
    readonly messageId: string;
    readonly reactions: readonly string[];
  }[];
};
type LiveRow = Extract<Row, { readonly kind: 'message' }>;

const toolClass =
  'flex size-8 items-center justify-center rounded-sm text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline';

function MessageTool({
  href,
  icon,
  label,
}: {
  readonly href: string;
  readonly icon: IconName;
  readonly label: string;
}) {
  return (
    <Link href={href} aria-label={label} title={label} className={toolClass}>
      <Icon name={icon} size={16} />
    </Link>
  );
}

function MessageTools({
  channelId,
  row,
  filesAvailable,
}: {
  readonly channelId: string;
  readonly row: LiveRow;
  readonly filesAvailable: boolean;
}) {
  const { message, mine } = row;
  return (
    <div className="absolute -top-1 right-6 z-10 flex gap-1 rounded-md border border-border bg-surface-raised p-1 message-tools max-narrow:right-4">
      <MessageTool
        href={`/messages/${channelId}/reactions?messageId=${message.id}`}
        icon="smile"
        label="Reactions"
      />
      {filesAvailable ? (
        <MessageTool
          href={`/messages/${channelId}/attachments?messageId=${message.id}`}
          icon="file"
          label="Attachments"
        />
      ) : null}
      {mine && filesAvailable ? (
        <MessageTool
          href={`/messages/${channelId}/attachments?messageId=${message.id}&attach=1`}
          icon="folder"
          label="Attach file"
        />
      ) : null}
      {mine ? (
        <MessageTool
          href={`/messages/${channelId}/message?messageId=${message.id}${message.sequence < Number.MAX_SAFE_INTEGER ? `&before=${message.sequence + 1}` : ''}`}
          icon="edit"
          label="Edit or remove your message"
        />
      ) : null}
    </div>
  );
}

function MessageRow({
  row,
  channelId,
  own,
  filesAvailable,
  reactAction,
  onReacted,
}: {
  readonly row: LiveRow;
  readonly channelId: string;
  readonly own: readonly string[];
  readonly filesAvailable: boolean;
  readonly reactAction: ReactionPillAction | undefined;
  readonly onReacted: (
    messageId: string,
    reaction: string,
    own: boolean,
  ) => void;
}) {
  const { message, leads, author, time } = row;
  const changed = useCallback(
    (reaction: string, mark: boolean) =>
      onReacted(message.id, reaction, mark),
    [message.id, onReacted],
  );
  return (
    <div
      className={cn(
        'flex gap-3 px-6 py-px message-row hover:bg-accent-soft focus-within:bg-accent-soft max-narrow:px-4',
        leads && 'mt-2',
      )}
    >
      {leads ? (
        <Avatar name={author} nameVisible />
      ) : (
        <time
          dateTime={message.createdAt}
          className="w-message-gutter shrink-0 pt-1 text-right text-message-time text-ink-muted tabular-nums message-run-time"
        >
          {time.replace(/\s.*$/, '')}
        </time>
      )}
      <div className="min-w-0 flex-1">
        {leads ? (
          <p className="flex items-baseline gap-2 leading-tight">
            <span className="text-sm font-strong">{author}</span>
            <time
              dateTime={message.createdAt}
              className="text-xs text-ink-muted"
            >
              {time}
            </time>
          </p>
        ) : null}
        <p className="max-w-message leading-normal wrap-anywhere whitespace-pre-wrap text-ink">
          <span>{message.text}</span>
          {message.editedAt ? (
            <span className="text-xs text-ink-muted"> (edited)</span>
          ) : null}
        </p>
        {message.reactions.length > 0 ? (
          <div className="flex flex-wrap gap-1 pt-1">
            {message.reactions.map(({ reaction, count }) =>
              reactAction ? (
                <ReactionPill
                  key={reaction}
                  action={reactAction}
                  channelId={channelId}
                  messageId={message.id}
                  reaction={reaction}
                  count={count}
                  own={own.includes(reaction)}
                  onChanged={changed}
                />
              ) : (
                <span
                  key={reaction}
                  className="inline-flex h-6 items-center gap-1 rounded-round border border-border px-2 text-xs font-semibold text-ink-muted tabular-nums"
                >
                  {reaction} {count}
                </span>
              ),
            )}
          </div>
        ) : null}
      </div>
      <MessageTools
        channelId={channelId}
        row={row}
        filesAvailable={filesAvailable}
      />
    </div>
  );
}

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
    <div className="flex items-center gap-2 px-6 pt-2 text-badge font-heavy tracking-wider text-accent uppercase max-narrow:px-4">
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
  const [own, setOwn] = useState<ReadonlyMap<string, readonly string[]>>(seeded);
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
  const [firstUnread] = useState(
    searchQuery === undefined ? (viewer?.firstUnreadSequence ?? null) : null,
  );
  const [own, reacted] = useOwnReactions(viewer);
  const rows = useMemo(
    () =>
      messageRows({
        messages: history.messages,
        actorId,
        otherAuthor,
        firstUnreadSequence: firstUnread,
        now,
        timeZone,
      }),
    [history.messages, actorId, otherAuthor, firstUnread, now, timeZone],
  );
  const earlier = latestLink
    ? null
    : earlierUnreadSequence(history.messages, firstUnread);
  const channelId = history.channelId;
  return (
    <div className="message-scroller min-h-0 flex-1 overflow-y-auto">
      <div className="py-4">
        <div className="flex flex-wrap justify-center gap-4 px-6 pb-2 text-sm font-semibold empty:hidden">
          {history.nextBefore ? (
            <Link
              href={`/messages/${channelId}?before=${history.nextBefore.sequence}${searchQuery === undefined ? '' : `&query=${encodeURIComponent(searchQuery)}`}`}
            >
              Earlier messages
            </Link>
          ) : null}
          {earlier !== null ? (
            // A page that begins at the first unread message, oldest first.
            <Link
              href={`/messages/${channelId}?before=${earlier + history.messages.length + 1}`}
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
              <li key={row.key}>
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

