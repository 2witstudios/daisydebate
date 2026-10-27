import Link from 'next/link';
import type { ReactNode } from 'react';
import type { FriendList } from '@daisy/protocol';
import type { FriendFormState } from '../../../features/messaging/friends/forms';
import { Avatar } from '../../components/avatar/avatar';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import type { FormAction } from '../../form-action/form-action';
import { profileHref } from '../../layout/app-shell/components/destinations';
import { AddFriendForm, FriendButtonForm } from '../friend-forms';
import { friendsLede, presenceLabel } from '../friends';

type Action = FormAction<FriendFormState>;

function Section({
  id,
  title,
  children,
}: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-2">
      <h2 id={id} className="text-sm font-semibold text-ink-muted">
        {title}
      </h2>
      {children}
    </section>
  );
}

function PersonRow({
  username,
  detail,
  presence,
  children,
}: {
  readonly username: string;
  readonly detail?: string;
  readonly presence?: FriendList['friends'][number]['presence'];
  readonly children: ReactNode;
}) {
  return (
    <li className="flex min-h-12 flex-wrap items-center gap-3 rounded-md px-2 py-1 hover:bg-surface-overlay">
      <Avatar name={username} size="sm" {...(presence ? { presence } : {})} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Link
          href={profileHref(username)}
          className="truncate text-base text-ink no-underline hover:no-underline"
        >
          @{username}
        </Link>
        {detail ? (
          <span className="text-sm text-ink-muted">{detail}</span>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">{children}</div>
    </li>
  );
}

/**
 * A member's friends, online first, the requests waiting on them and the
 * ones they sent, and a way to add someone. Every button is a native form,
 * so the page works before any script and with none.
 */
export function FriendsPage({
  list,
  friendAction,
  challengeAction,
  message,
}: {
  readonly list: FriendList | null;
  readonly friendAction: Action;
  readonly challengeAction: Action;
  /** The Message control for one friend; each carries its own request. */
  readonly message: (username: string) => ReactNode;
}) {
  return (
    <ReadingPage>
      <PageHeader
        title="Friends"
        lede={list ? friendsLede(list) : 'Friends are unavailable right now.'}
      />
      {list && list.challenges.length > 0 ? (
        <Section id="friends-challenges" title="Challenges">
          <ul className="flex flex-col">
            {list.challenges.map(({ username, roomId, title }) => (
              <PersonRow
                key={roomId}
                username={username}
                detail={`Challenged you: ${title}`}
              >
                {/* A document load: the room's media page sets its own camera policy. */}
                <a
                  href={`/rooms/${roomId}`}
                  aria-label={`Join @${username}'s challenge`}
                  className={cn(
                    buttonClass('primary'),
                    'px-3 py-2 text-sm no-underline hover:no-underline',
                  )}
                >
                  Join
                </a>
                <FriendButtonForm
                  action={friendAction}
                  username={username}
                  roomId={roomId}
                  intent="decline-challenge"
                  label="Decline"
                  accessibleName={`Decline @${username}'s challenge`}
                  variant="ghost"
                />
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}
      {list && list.incoming.length > 0 ? (
        <Section id="friends-incoming" title="Requests">
          <ul className="flex flex-col">
            {list.incoming.map(({ username }) => (
              <PersonRow
                key={username}
                username={username}
                detail="Wants to be friends"
              >
                <FriendButtonForm
                  action={friendAction}
                  username={username}
                  intent="accept"
                  label="Accept"
                  variant="primary"
                />
                <FriendButtonForm
                  action={friendAction}
                  username={username}
                  intent="decline"
                  label="Decline"
                  variant="ghost"
                />
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}
      {list && list.friends.length > 0 ? (
        <Section id="friends-list" title="Your friends">
          <ul className="flex flex-col">
            {list.friends.map(({ username, presence }) => (
              <PersonRow
                key={username}
                username={username}
                presence={presence}
                detail={presenceLabel[presence]}
              >
                <FriendButtonForm
                  action={challengeAction}
                  username={username}
                  intent="challenge"
                  label="Challenge"
                />
                {message(username)}
                <FriendButtonForm
                  action={friendAction}
                  username={username}
                  intent="remove"
                  label="Remove"
                  variant="ghost"
                />
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}
      {list && list.outgoing.length > 0 ? (
        <Section id="friends-outgoing" title="Sent requests">
          <ul className="flex flex-col">
            {list.outgoing.map(({ username }) => (
              <PersonRow
                key={username}
                username={username}
                detail="Waiting for an answer"
              >
                <FriendButtonForm
                  action={friendAction}
                  username={username}
                  intent="cancel"
                  label="Cancel"
                  variant="ghost"
                />
              </PersonRow>
            ))}
          </ul>
        </Section>
      ) : null}
      <Section id="friends-add" title="Add a friend">
        <AddFriendForm action={friendAction} />
      </Section>
    </ReadingPage>
  );
}
