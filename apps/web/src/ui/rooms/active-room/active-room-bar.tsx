'use client';

import { usePathname } from 'next/navigation';
import type { ActiveRoom } from '@daisy/protocol';
import { ActiveRoomNotice } from './active-room-notice';

/** The shell's way back to the active Room, except where it already shows. */
export function ActiveRoomBar({
  activeRoom,
}: {
  readonly activeRoom: ActiveRoom | null;
}) {
  const pathname = usePathname();
  if (!activeRoom || activeRoomShown(pathname, activeRoom)) return null;
  return (
    <div className="mx-auto w-full max-w-dash-column px-6 pt-4 max-narrow:px-4">
      <ActiveRoomNotice activeRoom={activeRoom} />
    </div>
  );
}

/** The Room's own page, and the lobby that lists it, already show it. */
export const activeRoomShown = (pathname: string, activeRoom: ActiveRoom) =>
  pathname === activeRoom.href ||
  pathname === `/rooms/${activeRoom.id}` ||
  pathname === '/lobby';
