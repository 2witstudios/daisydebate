'use client';
import {
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Icon } from '../components/icon/icon';
import { matchesRoute } from '../components/nav-item/nav-item';
import { InboxRow, hrefOf } from './inbox-row';
import { inboxPageHref } from '../../features/messaging/inbox-view';
import { useInbox } from './inbox-provider';

const tool =
  'flex size-nav-target shrink-0 items-center justify-center rounded-sm text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline';
const footLink =
  'flex min-h-nav-target items-center gap-2 rounded-sm px-2 text-sm font-semibold text-ink-muted no-underline hover:bg-surface-overlay hover:text-ink hover:no-underline';

/**
 * Every conversation, beside whichever one is open. Without JavaScript the
 * search is a GET and the next page a link, and both answer in the open pane,
 * because a layout cannot read the query.
 */
export function ConversationList({
  groupsOffered,
  retained,
}: {
  readonly groupsOffered: boolean;
  /** A survivor's retained conversations; nothing when there are none. */
  readonly retained: ReactNode;
}) {
  const inbox = useInbox();
  const pathname = usePathname();
  const [reading, setReading] = useState(false);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    inbox.setSearch(inbox.search);
  };
  const more = (after: string) => async (event: MouseEvent) => {
    // The visible cursor belongs to the applied question, not text still waiting
    // for its debounced result. Its native destination preserves that question.
    if (inbox.search.trim() !== (inbox.appliedSearch ?? '')) return;
    event.preventDefault();
    setReading(true);
    const read = await inbox.more(after);
    setReading(false);
    // A refused read still has the link's native answer to offer.
    if (!read)
      window.location.assign(inboxPageHref(after, inbox.appliedSearch));
  };
  return (
    <>
      <header className="flex h-pane-header shrink-0 items-center justify-between border-b border-border pr-2 pl-4">
        <h2 className="font-display text-lg leading-tight font-semibold">
          Messages
        </h2>
        <Link
          href="/messages/new"
          aria-label="New message"
          title="New message"
          className={tool}
        >
          <Icon name="plus" />
        </Link>
      </header>
      <form
        role="search"
        action="/messages"
        method="get"
        onSubmit={submit}
        className="shrink-0 p-2"
      >
        <label className="flex h-10 items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-ink-muted focus-within:border-border-strong hover:border-border-strong">
          <Icon name="search" size={16} />
          <span className="sr-only">Search conversations</span>
          <input
            type="search"
            name="q"
            value={inbox.search}
            onChange={(event) => inbox.setSearch(event.target.value)}
            maxLength={200}
            placeholder="Search conversations"
            className="h-full w-full min-w-0 bg-transparent text-sm text-ink placeholder:text-ink-muted"
          />
        </label>
      </form>
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!inbox.available ? (
          <p className="p-2 text-sm text-ink-muted">
            Messages are unavailable. Refresh to try again.
          </p>
        ) : inbox.entries.length === 0 ? (
          <p className="p-2 text-sm text-ink-muted">
            {inbox.searching
              ? 'No conversations match.'
              : inbox.nextAfter === null
                ? 'No conversations yet.'
                : 'No conversations on this page.'}
          </p>
        ) : (
          <ul
            aria-label="Conversations"
            className="flex list-none flex-col gap-1"
          >
            {inbox.entries.map((entry) => {
              const href = hrefOf(entry);
              return (
                <InboxRow
                  key={entry.channelId}
                  entry={entry}
                  now={inbox.now}
                  current={matchesRoute(pathname, href)}
                  inert={pathname === href}
                />
              );
            })}
          </ul>
        )}
        {inbox.nextAfter ? (
          <Link
            href={inboxPageHref(inbox.nextAfter, inbox.appliedSearch)}
            onClick={more(inbox.nextAfter)}
            aria-disabled={reading}
            className={`${footLink} justify-center`}
          >
            More conversations
          </Link>
        ) : null}
        {retained}
      </div>
      <nav
        aria-label="Messaging tools"
        className="flex shrink-0 flex-col border-t border-border p-2"
      >
        {groupsOffered ? (
          <Link href="/messages/new?kind=group" className={footLink}>
            <Icon name="users" size={16} />
            Create private group
          </Link>
        ) : null}
        <Link href="/messages/contacts" className={footLink}>
          <Icon name="lock" size={16} />
          Contact safety
        </Link>
      </nav>
    </>
  );
}
