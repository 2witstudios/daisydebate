'use client';

import Link from 'next/link';
import { avatarSrc } from '../../assets';
import { Avatar } from '../../components/avatar/avatar';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { useUiState } from '../../store/store';
import { friendGroups, onlineNow } from '../friends';

/**
 * A member's friends who are around, grouped by what they are doing, each
 * with a link to their profile and what you can do with them right now.
 */
export function FriendsPage() {
  const users = useUiState((state) => state.collections.onlineUsers);
  return (
    <ReadingPage>
      <PageHeader title="Friends" lede={`${onlineNow(users)} online`} />
      {friendGroups(users).map((group) => (
        <section
          key={group.status}
          aria-labelledby={`friends-${group.status}`}
          className="flex flex-col gap-1"
        >
          <h2
            id={`friends-${group.status}`}
            className="text-sm font-semibold text-ink-muted"
          >
            {group.label}
          </h2>
          <ul className="flex flex-col">
            {group.people.map((person) => (
              <li
                key={person.name}
                className="flex min-h-12 items-center gap-3 rounded-md px-2 hover:bg-surface-overlay"
              >
                <Avatar
                  name={person.name}
                  src={avatarSrc(person.name)}
                  presence={person.status}
                  size="sm"
                  nameVisible
                />
                <Link
                  href={person.profileHref}
                  className="min-w-0 flex-1 truncate text-base text-ink no-underline hover:no-underline"
                >
                  {person.name}
                </Link>
                {person.action ? (
                  <Link
                    href={person.action.href}
                    className="flex min-h-nav-target items-center px-2 text-sm font-semibold no-underline hover:no-underline"
                  >
                    {person.action.label}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </ReadingPage>
  );
}
