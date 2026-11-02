'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '../cn';
import { useOnline } from './online-provider';

const seg =
  'flex min-h-nav-target flex-1 items-center justify-center rounded-sm text-md font-semibold text-ink-muted no-underline hover:no-underline aria-[current=page]:bg-surface-raised aria-[current=page]:text-ink';

/** How many are online, for the switch's label. */
export function OnlineCount() {
  const { roster } = useOnline();
  return <>{roster.counts.everyone}</>;
}

/**
 * The phone's Rooms and Online switch (ADR 0097). Plain links, so it works
 * without script; from a tablet up the rail holds the list and this is hidden.
 */
export function LobbyViews({
  view,
  rooms,
  online,
  onlineCount,
}: {
  readonly view: 'rooms' | 'online';
  readonly rooms: ReactNode;
  readonly online: ReactNode;
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
          aria-current={view === 'online' ? 'page' : undefined}
          className={seg}
        >
          Online {onlineCount}
        </Link>
      </nav>
      <div className={cn(view === 'online' && 'max-narrow:hidden')}>
        {rooms}
      </div>
      <div
        className={cn(
          'hidden px-4 pt-4',
          view === 'online' && 'max-narrow:block',
        )}
      >
        {online}
      </div>
    </>
  );
}
