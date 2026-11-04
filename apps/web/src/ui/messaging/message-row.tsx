'use client';
import { useCallback } from 'react';
import { ConversationLink as Link } from './conversation-navigation';
import type { MessageRow as Row } from '../../features/messaging/message-rows';
import { Avatar } from '../components/avatar/avatar';
import { Icon, type IconName } from '../components/icon/icon';
import { cn } from '../cn';
import { ReactionPill, type ReactionPillAction } from './reaction-pill';

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
    <Link
      prefetch={false}
      href={href}
      aria-label={label}
      title={label}
      className={toolClass}
    >
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

export function MessageRow({
  row,
  channelId,
  own,
  filesAvailable,
  reactAction,
  onReacted,
  observed,
}: {
  readonly row: LiveRow;
  readonly channelId: string;
  readonly own: readonly string[];
  readonly filesAvailable: boolean;
  readonly reactAction: ReactionPillAction | undefined;
  readonly observed: boolean;
  readonly onReacted: (
    messageId: string,
    reaction: string,
    own: boolean,
  ) => void;
}) {
  const { message, leads, author, time } = row;
  const changed = useCallback(
    (reaction: string, mark: boolean) => onReacted(message.id, reaction, mark),
    [message.id, onReacted],
  );
  return (
    <div
      className={cn(
        'message-row flex gap-3 px-6 py-px focus-within:bg-accent-soft hover:bg-accent-soft max-narrow:px-4',
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
                  key={`${reaction}:${observed ? 'live' : message.changeVersion}`}
                  action={reactAction}
                  channelId={channelId}
                  messageId={message.id}
                  reaction={reaction}
                  count={count}
                  own={own.includes(reaction)}
                  onChanged={changed}
                  observed={observed}
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
