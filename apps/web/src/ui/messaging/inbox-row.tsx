import Link from 'next/link';
import type { MessagingInboxEntry } from '../../features/messaging/inbox';
import { formatInboxTime } from '../../features/messaging/inbox-time';
import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';

const hrefOf = (entry: MessagingInboxEntry) =>
  entry.kind === 'incoming_invitation'
    ? `/messages/groups/invitations/${entry.channelId}`
    : entry.kind === 'incoming_request'
      ? `/messages/requests/${entry.channelId}`
      : entry.kind === 'outgoing_request'
        ? `/messages/requests/${entry.channelId}/status`
        : `/messages/${entry.channelId}`;

/** Visible kind badge plus the words a screen reader hears before the name. */
const kinds = {
  conversation: { badge: null, spoken: '' },
  group_conversation: { badge: 'Group', spoken: 'Group ' },
  incoming_request: { badge: 'Request', spoken: 'Message request from ' },
  outgoing_request: { badge: 'Sent', spoken: 'Sent request to ' },
} as const;

/**
 * One inbox entry: the whole card opens the conversation, request or
 * invitation; group membership stays a separate, stacked link.
 */
export function InboxRow({
  entry,
  now,
}: {
  readonly entry: MessagingInboxEntry;
  readonly now: string;
}) {
  if (entry.kind === 'incoming_invitation')
    return (
      <li className="relative flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4">
        <Avatar name="Group" nameVisible />
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <Link
            href={hrefOf(entry)}
            className="font-semibold text-ink after:absolute after:inset-0"
          >
            Group invitation
          </Link>
          <p className="text-sm text-ink-muted">
            Open it to see the group and decide.
          </p>
        </div>
        <UnreadMark />
      </li>
    );
  const kind = kinds[entry.kind];
  const title =
    entry.title ??
    (entry.kind === 'group_conversation'
      ? 'Untitled group'
      : 'Deleted account');
  return (
    <li className="relative flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4">
      <Avatar name={title} nameVisible />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <Link
            href={hrefOf(entry)}
            className={`min-w-0 truncate text-ink after:absolute after:inset-0 ${entry.unread ? 'font-heavy' : 'font-semibold'}`}
          >
            {kind.spoken ? (
              <span className="sr-only">{kind.spoken}</span>
            ) : null}
            {title}
          </Link>
          {kind.badge ? (
            <span aria-hidden="true">
              <Badge
                tone={entry.kind === 'incoming_request' ? 'accent' : 'neutral'}
              >
                {kind.badge}
              </Badge>
            </span>
          ) : null}
          <time
            dateTime={entry.activityAt}
            className="ml-auto shrink-0 text-xs text-ink-muted"
          >
            {formatInboxTime(entry.activityAt, now)}
          </time>
        </div>
        <p
          className={`truncate text-sm ${entry.unread ? 'text-ink' : 'text-ink-muted'}`}
        >
          {entry.preview === null
            ? entry.kind === 'outgoing_request'
              ? 'Waiting for a reply.'
              : entry.kind === 'incoming_request'
                ? 'No introduction.'
                : 'No messages yet.'
            : `${entry.preview.fromSelf ? 'You: ' : ''}${entry.preview.text}`}
        </p>
      </div>
      {entry.unread ? <UnreadMark /> : null}
      {entry.kind === 'group_conversation' ? (
        <Link
          className="relative z-10 shrink-0 text-sm"
          href={`/messages/groups/${entry.channelId}/manage`}
        >
          Group membership
        </Link>
      ) : null}
    </li>
  );
}

function UnreadMark() {
  return (
    <span className="flex shrink-0 items-center">
      <span aria-hidden="true" className="size-2.5 rounded-full bg-accent" />
      <span className="sr-only">Unread</span>
    </span>
  );
}
