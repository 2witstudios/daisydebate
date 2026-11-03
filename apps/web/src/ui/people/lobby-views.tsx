'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { usePeople } from './people-provider';

const seg =
  'flex min-h-nav-target flex-1 items-center justify-center rounded-sm text-md font-semibold text-ink-muted no-underline hover:no-underline aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink';

/** How many are online, for the switch's label. */
export function OnlineCount() {
  const { list } = usePeople();
  return <>{list.counts.online}</>;
}

/**
 * The phone's Rooms and People switch (ADR 0105). Plain links, so it works
 * without script; from a tablet up the rail holds the list and this is hidden.
 */
export function LobbyViews({
  view,
  rooms,
  people,
  onlineCount,
}: {
  readonly view: 'rooms' | 'people';
  readonly rooms: ReactNode;
  readonly people: ReactNode;
  readonly onlineCount: ReactNode;
}) {
  return (
    <>
      <nav
        aria-label="Lobby views"
        className="mx-4 mt-4 hidden gap-1 rounded-md bg-surface-overlay p-1 max-narrow:flex"
      >
        <Link
          href="/lobby?view=rooms"
          aria-current={view === 'rooms' ? 'page' : undefined}
          className={seg}
        >
          Rooms
        </Link>
        <Link
          href="/lobby"
          aria-current={view === 'people' ? 'page' : undefined}
          className={seg}
        >
          People · {onlineCount} online
        </Link>
      </nav>
      <div className={cn(view === 'people' && 'max-narrow:hidden')}>
        {rooms}
      </div>
      <div
        className={cn(
          'hidden px-4 pt-4',
          view === 'people' && 'max-narrow:block',
        )}
      >
        <h1 className="mb-3 font-display text-2xl font-semibold">Lobby</h1>
        {people}
      </div>
    </>
  );
}
