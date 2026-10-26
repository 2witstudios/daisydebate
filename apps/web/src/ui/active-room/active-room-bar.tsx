'use client';

import { usePathname } from 'next/navigation';
import { matchesRoute } from '../components/nav-item/nav-item';
import { MediaPageLink } from '../round-media/media-page-link';
import {
  activeRoomDotClass,
  activeRoomPhaseLabel,
  type ActiveRoomSummary,
} from './your-room';

/** Home and the Lobby pin the Room themselves; its own page needs no way back. */
export const showsActiveRoomBar = (
  pathname: string | null,
  href: string,
): boolean =>
  pathname !== '/' && pathname !== '/lobby' && !matchesRoute(pathname, href);

/**
 * A slim bar above every other shell page while the viewer is in a Room, so
 * wherever they wander there is one way back.
 */
export function ActiveRoomBar({ room }: { readonly room: ActiveRoomSummary }) {
  const pathname = usePathname();
  if (!showsActiveRoomBar(pathname, room.href)) return null;
  return (
    <MediaPageLink
      href={room.href}
      aria-label={`Return to room: ${room.title}, ${activeRoomPhaseLabel(room.phase)}`}
      className="flex items-center gap-3 bg-butter px-6 py-2 text-sm text-forest no-underline hover:no-underline max-narrow:px-4"
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
