import Link from 'next/link';
import type { MouseEvent } from 'react';
import { cn } from '../cn';
import type { MessagingInboxEntry } from '../../features/messaging/inbox-view';
import { formatInboxTime } from '../../features/messaging/inbox-time';
import { Avatar } from '../components/avatar/avatar';
import { Badge } from '../components/badge/badge';
import type { BadgeTone } from '../components/badge/badge-class';

export const hrefOf = (entry: MessagingInboxEntry) =>
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

const rowClass = (current: boolean) =>
  cn(
    'relative flex min-h-nav-target items-center gap-3 rounded-md p-2 hover:bg-surface-overlay',
    current && 'bg-accent-soft',
  );
const coverLink = 'after:absolute after:inset-0 hover:no-underline';

/** Already here: following the link again would only undo a page of history. */
const stayHere = (event: MouseEvent) => event.preventDefault();

/**
 * One inbox entry, a flat row whose whole width opens the conversation,
 * request or invitation. The open one says so; its link goes nowhere new.
 */
export function InboxRow({
  entry,
  now,
  current = false,
  inert = false,
}: {
  readonly entry: MessagingInboxEntry;
  readonly now: string;
  /** This conversation is open beside the list. */
  readonly current?: boolean;
  /** The reader is on this exact route. */
  readonly inert?: boolean;
}) {
  const link = {
    href: hrefOf(entry),
    ...(current ? { 'aria-current': 'page' as const } : {}),
    ...(inert ? { onClick: stayHere } : {}),
  };
  return entry.kind === 'incoming_invitation' ? (
    <InvitationRow link={link} current={current} />
  ) : (
    <SummaryRow entry={entry} now={now} link={link} current={current} />
  );
}

type RowLink = {
  readonly href: string;
  readonly 'aria-current'?: 'page';
  readonly onClick?: (event: MouseEvent) => void;
};

function InvitationRow({
  link,
  current,
}: {
  readonly link: RowLink;
  readonly current: boolean;
}) {
  return (
    <li className={rowClass(current)}>
      <Avatar name="Group" nameVisible />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link {...link} className={`font-semibold text-ink ${coverLink}`}>
          Group invitation
        </Link>
        <p className="truncate text-sm text-ink-muted">
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
  link,
  current,
}: {
  readonly entry: Summarized;
  readonly now: string;
  readonly link: RowLink;
  readonly current: boolean;
}) {
  const kind = kinds[entry.kind];
  const title = entry.title ?? kind.unnamed;
  return (
    <li className={rowClass(current)}>
      <Avatar name={title} nameVisible />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-baseline gap-2">
          {/* An explicit name: hidden spans around the title join unpredictably. */}
          <Link
            {...link}
            aria-label={`${kind.spoken}${title}${entry.unread ? ', unread' : ''}`}
            className={`min-w-0 truncate text-ink ${coverLink} ${entry.unread ? 'font-heavy' : 'font-semibold'}`}
          >
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
        <div className="flex items-center gap-2">
          <p
            className={`min-w-0 flex-1 truncate text-sm ${entry.unread ? 'text-ink' : 'text-ink-muted'}`}
          >
            {previewLine(entry, kind.empty)}
          </p>
          {entry.unread ? <UnreadMark /> : null}
        </div>
      </div>
    </li>
  );
}

const previewLine = (entry: Summarized, empty: string) =>
  entry.preview === null
    ? empty
    : `${entry.preview.fromSelf ? 'You: ' : ''}${entry.preview.text}`;

/** Visual only: the row's link already names its unread state. */
function UnreadMark() {
  return (
    <span
      aria-hidden="true"
      className="inline-block size-presence-dot shrink-0 rounded-round bg-accent"
    />
  );
}
