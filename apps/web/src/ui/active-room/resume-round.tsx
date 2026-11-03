'use client';

import type { ActiveRoom } from '@daisy/protocol';
import { useEffect, useRef, useState } from 'react';
import { hasDeparted } from '../../features/rooms/resume-departure';
import { resumeRoundHrefOf } from '../../features/rooms/resume';
import {
  attemptedResume,
  markResumeAttempt,
} from '../../features/rooms/resume-attempt';
import { TabElsewhere } from '../../features/rooms/tab-elsewhere';
import { useResumeLifetime } from '../../features/rooms/use-resume-lifetime';

/** Round id inside the signed href, when the Round actually launched. */
const roundIdOf = (href: string): string | null => {
  const matched = /\/rounds\/([a-z0-9]{24})\/room$/.exec(href);
  return matched?.[1] ?? null;
};

type ActiveRoomRef = Pick<ActiveRoom, 'phase' | 'href' | 'seated'>;

/**
 * The server supplies canonical membership; local ownership only coordinates
 * navigation, and only a tab that would resume takes part in it. A tab that
 * waited read its Round when the page loaded, so it reads again before moving.
 */
export function ResumeRound({
  room,
  actorId,
}: {
  readonly room: ActiveRoomRef | null;
  readonly actorId: string | null;
}) {
  const roundId = room === null ? null : roundIdOf(room.href);
  // Output is identical until ownership is known, so the server's false cannot mismatch.
  const [departed] = useState(
    () =>
      typeof window !== 'undefined' &&
      roundId !== null &&
      hasDeparted(actorId, roundId),
  );
  const [attempted] = useState(
    () =>
      typeof window !== 'undefined' &&
      roundId !== null &&
      attemptedResume(actorId, roundId),
  );
  const resuming = resumeRoundHrefOf({ actorId, room, departed, attempted });
  const ownership = useResumeLifetime(actorId, resuming ? roundId : null);
  const waited = useRef(false);
  useEffect(() => {
    if (resuming === null || ownership.owns === null) return;
    if (!ownership.owns) waited.current = true;
    else if (waited.current) window.location.reload();
    else {
      if (actorId !== null && roundId !== null)
        markResumeAttempt(actorId, roundId);
      window.location.replace(resuming);
    }
  }, [resuming, ownership.owns, actorId, roundId]);
  return resuming !== null && ownership.owns === false ? (
    <div>
      <TabElsewhere takeOver={ownership.takeOver} />
    </div>
  ) : null;
}
