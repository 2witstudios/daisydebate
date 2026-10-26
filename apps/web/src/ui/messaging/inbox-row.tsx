import Link from 'next/link';
import type { MessagingInboxEntry } from '../../features/messaging/inbox';
import { formatInboxTime } from '../../features/messaging/inbox-time';
import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import type { BadgeTone } from '../components/badge/badge-class';

const hrefOf = (entry: MessagingInboxEntry) =>
  entry.kind === 'incoming_invitation'
    ? `/messages/groups/invitations/${entry.channelId}`
    : entry.kind === 'incoming_request'
      ? `/messages/requests/${entry.channelId}`
      : entry.kind === 'outgoing_request'
        ? `/messages/requests/${entry.channelId}/status`
        : `/messages/${entry.channelId}`;

type Summarized = Exclude<
  MessagingInboxEntry,
  { readonly kind: 'incoming_invitation' }
>;

/**
 * Per kind: the visible badge, the words a screen reader hears before the
 * name, the name shown when the identity was erased, and the line shown
 * when there is nothing to preview.
 */
const kinds: Readonly<
  Record<
    Summarized['kind'],
    {
      readonly badge: {
        readonly text: string;
        readonly tone: BadgeTone;
      } | null;
      readonly spoken: string;
      readonly unnamed: string;
      readonly empty: string;
    }
  >
> = {
  conversation: {
    badge: null,
    spoken: '',
    unnamed: 'Deleted account',
    empty: 'No messages yet.',
  },
  group_conversation: {
    badge: { text: 'Group', tone: 'neutral' },
    spoken: 'Group ',
    unnamed: 'Untitled group',
    empty: 'No messages yet.',
  },
  incoming_request: {
    badge: { text: 'Request', tone: 'accent' },
    spoken: 'Message request from ',
    unnamed: 'Deleted account',
    empty: 'No introduction.',
  },
  outgoing_request: {
    badge: { text: 'Sent', tone: 'neutral' },
    spoken: 'Sent request to ',
    unnamed: 'Deleted account',
    empty: 'Waiting for a reply.',
  },
};

const cardClass =
  'relative flex items-center gap-3 rounded-lg border border-border bg-surface-raised p-4';
const coverLink = 'after:absolute after:inset-0';

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
  return entry.kind === 'incoming_invitation' ? (
    <InvitationRow href={hrefOf(entry)} />
  ) : (
    <SummaryRow entry={entry} now={now} />
  );
}

function InvitationRow({ href }: { readonly href: string }) {
  return (
    <li className={cardClass}>
      <Avatar name="Group" nameVisible />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <Link href={href} className={`font-semibold text-ink ${coverLink}`}>
          Group invitation
        </Link>
        <p className="text-sm text-ink-muted">
          Open it to see the group and decide.
        </p>
      </div>
      <UnreadMark />
    </li>
  );
}

function SummaryRow({
  entry,
  now,
}: {
  readonly entry: Summarized;
  readonly now: string;
}) {
  const kind = kinds[entry.kind];
  const title = entry.title ?? kind.unnamed;
  return (
    <li className={cardClass}>
      <Avatar name={title} nameVisible />
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-baseline gap-2">
          <Link
            href={hrefOf(entry)}
            className={`min-w-0 truncate text-ink ${coverLink} ${entry.unread ? 'font-heavy' : 'font-semibold'}`}
          >
            {kind.spoken ? (
              <span className="sr-only">{kind.spoken}</span>
            ) : null}
            {title}
          </Link>
          {kind.badge ? (
            <span aria-hidden="true">
              <Badge tone={kind.badge.tone}>{kind.badge.text}</Badge>
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
            ? kind.empty
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
      <span
        aria-hidden="true"
        className="inline-block size-presence-dot rounded-round bg-accent"
      />
      <span className="sr-only">Unread</span>
    </span>
  );
}
