'use client';
import { useDeliver } from '../edge/use-answer';
import { isRoundOver } from '@daisy/protocol/round';
import { postRoundCallChosen } from '../../features/post-round-call/offered';
import { useMemo, useState } from 'react';
import type { RoundView } from '@daisy/protocol/round-view';
import { clearDeparture } from '../../features/rooms/resume-departure';
import { clearResumeAttempt } from '../../features/rooms/resume-attempt';
import { useResumeLifetime } from '../active-room/use-resume-lifetime';
import type { RoundMediaTab } from '../round-media/media-session';

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

/** A seat's one identity admits one connection, so every seated room holds a claim. */
export function useRoundMediaTab(
  actorId: string,
  view: RoundView,
): RoundMediaTab {
  const [stepDown] = useState(createStepDown);
  // Entering a Round's room settles any departure or resume it recorded.
  useDeliver(`${actorId}\u0000${view.id}`, () => {
    clearDeparture(actorId, view.id);
    clearResumeAttempt(actorId, view.id);
  });
  const ownership = useResumeLifetime(
    actorId,
    // A post-round call still holds this seat's one connection.
    isRoundOver(view.status) && !postRoundCallChosen(view) ? null : view.id,
    // The member left: this waiting room captures nothing and checks in nothing.
    () => window.location.replace('/lobby'),
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
