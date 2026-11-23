'use client';

import { browserTransport } from '../edge/browser-request';
import { useAnswer } from '../edge/use-answer';
import { useResource } from '../edge/use-driver';
import { useState } from 'react';
import { refreshActiveRoom } from './refresh-membership';
import { usePathname } from 'next/navigation';
import { matchesRoute } from '../components/nav-item/nav-item';
import { MediaPageLink } from '../round-media/media-page-link';
import {
  activeRoomDotClass,
  activeRoomPhaseLabel,
  type ActiveRoomSummary,
} from './your-room';

/**
 * Home and the Lobby pin the Room themselves, and neither the Room's page nor
 * its live Round's room needs a way back.
 */
export const showsActiveRoomBar = (
  pathname: string | null,
  room: Pick<ActiveRoomSummary, 'id' | 'href'>,
): boolean =>
  pathname !== '/' &&
  pathname !== '/lobby' &&
  !matchesRoute(pathname, room.href) &&
  !matchesRoute(pathname, `/rooms/${room.id}`);

/**
 * A slim bar above every other shell page while the viewer is in a Room, so
 * wherever they wander there is one way back.
 */
/**
 * The bar's reader: it reads once on opening, each read replaces the one
 * before it, and leaving aborts the last.
 */
function openActiveRoomReader(adopt: (room: ActiveRoomSummary | null) => void) {
  let current: AbortController | null = null;
  const read = () => {
    current?.abort();
    const controller = new AbortController();
    current = controller;
    void refreshActiveRoom(browserTransport, controller.signal, adopt);
  };
  read();
  return { read, dispose: () => current?.abort() };
}

export function ActiveRoomBar({
  room: seed,
}: {
  readonly room: ActiveRoomSummary | null;
}) {
  const pathname = usePathname();
  const [room, setRoom] = useState(seed);
  // The reader reads as it opens; each page the viewer reaches, and each
  // new seed, reads the Room again.
  const reader = useResource(setRoom, openActiveRoomReader);
  useAnswer(pathname, () => reader?.read());
  useAnswer(seed, () => reader?.read());
  if (!room || !showsActiveRoomBar(pathname, room)) return null;
  return (
    <MediaPageLink
      href={room.href}
      aria-label={`Return to room: ${room.title}, ${activeRoomPhaseLabel(room.phase)}`}
      className="flex items-center gap-3 border-b border-border bg-hue-teal-soft px-6 py-2 text-sm text-ink no-underline hover:no-underline max-narrow:px-4"
    >
      <span className={activeRoomDotClass(room.phase)} aria-hidden="true" />
      <span className="min-w-0 truncate">
        <strong className="font-strong">{room.title}</strong>
        {` · ${activeRoomPhaseLabel(room.phase)}`}
      </span>
      <span className="ml-auto shrink-0 font-heavy underline">
        Return to room
      </span>
    </MediaPageLink>
  );
}
