'use client';

import type { ActiveRoom } from '@daisy/protocol';
import { useEffect } from 'react';
import { departedInSession } from '../../features/round-media/media-preferences';
import { resumeRoundHrefOf } from '../../features/rooms/resume';
import { useResumeLifetime } from '../../features/rooms/use-resume-lifetime';
import {
  markResumedOnce,
  resumedInThisTab,
} from '../../features/rooms/resume-ownership';

/** Round id inside the signed href, when the Round actually launched. */
export const roundIdOf = (href: string): string | null => {
  const matched = /\/rounds\/([a-z0-9]{24})\/room$/.exec(href);
  return matched?.[1] ?? null;
};

type ActiveRoomRef = Pick<ActiveRoom, 'phase' | 'href'>;

/** The server supplies canonical membership; local ownership only coordinates navigation. */
export function ResumeRound({
  room,
  actorId,
}: {
  readonly room: ActiveRoomRef | null;
  readonly actorId: string | null;
}) {
  const roundId = room === null ? null : roundIdOf(room.href);
  const ownership = useResumeLifetime(actorId, roundId);
  useEffect(() => {
    if (actorId === null || roundId === null || !ownership.owns) return;
    const href = resumeRoundHrefOf({
      actorId,
      room,
      departed: departedInSession(actorId, roundId),
    });
    if (
      href === null ||
      resumedInThisTab(window.sessionStorage, actorId, roundId)
    )
      return;
    markResumedOnce(window.sessionStorage, actorId, roundId);
    window.location.replace(href);
  }, [actorId, roundId, room, ownership.owns]);
  return ownership.owns === false ? (
    <div>
      <p role="status">This Round is open in another tab.</p>
      <button type="button" onClick={ownership.takeOver}>
        Use this tab
      </button>
    </div>
  ) : null;
}
