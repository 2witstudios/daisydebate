'use client';
import { useEffect, useMemo, useState } from 'react';
import type { RoundView } from '@daisy/protocol';
import { clearDeparture } from '../../features/rooms/resume-departure';
import { clearResumeAttempt } from '../../features/rooms/resume-attempt';
import { useResumeLifetime } from '../../features/rooms/use-resume-lifetime';
import type { RoundMediaTab } from '../../features/round-media/media-session';

/** Losing this tab's claim releases whichever media session is mounted now. */
const createStepDown = () => {
  let release: (() => void) | null = null;
  return {
    register: (next: () => void) => {
      release = next;
      return () => {
        release = null;
      };
    },
    fire: () => release?.(),
  };
};

const roundIsLive = (view: RoundView) =>
  view.status !== 'completed' && view.status !== 'abandoned';

/** A seat's one identity admits one connection, so every seated room holds a claim. */
export function useRoundMediaTab(
  actorId: string,
  view: RoundView,
): RoundMediaTab {
  const [stepDown] = useState(createStepDown);
  useEffect(() => {
    clearDeparture(actorId, view.id);
    clearResumeAttempt(actorId, view.id);
  }, [actorId, view.id]);
  const ownership = useResumeLifetime(
    actorId,
    roundIsLive(view) ? view.id : null,
    stepDown.fire,
  );
  return useMemo(
    () => ({
      owns: ownership.owns,
      takeOver: ownership.takeOver,
      onStepDown: stepDown.register,
    }),
    [ownership.owns, ownership.takeOver, stepDown],
  );
}
