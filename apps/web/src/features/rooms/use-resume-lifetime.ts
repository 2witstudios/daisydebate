'use client';

import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createResumeLifetime } from './resume-lifetime';
import {
  resumeOwnershipHeartbeatMs,
  subscribeOwnership,
} from './resume-ownership';

// One document identity, never sessionStorage (which a newly opened tab may clone).
let documentTabId: string | null = null;

export function useResumeLifetime(
  actorId: string | null,
  roundId: string | null,
  steppedDown?: () => void,
) {
  const [claim, setClaim] = useState<{
    readonly actorId: string;
    readonly roundId: string;
    readonly owns: boolean;
  } | null>(null);
  const owns =
    claim?.actorId === actorId && claim?.roundId === roundId
      ? claim.owns
      : null;
  const lifetime = useRef<ReturnType<typeof createResumeLifetime> | null>(null);
  const onStepDown = useRef(steppedDown);
  useEffect(() => {
    onStepDown.current = steppedDown;
  }, [steppedDown]);
  useEffect(() => {
    if (actorId === null || roundId === null) return;
    documentTabId ??= createId();
    const current = createResumeLifetime({
      actorId,
      roundId,
      tabId: documentTabId,
      storage: window.localStorage,
      now: () => Date.parse(systemClock.now()),
      subscribe: (listener) =>
        subscribeOwnership(window, actorId, roundId, listener),
      schedule: (tick) => {
        const timer = window.setInterval(tick, resumeOwnershipHeartbeatMs);
        return () => window.clearInterval(timer);
      },
      changed: (value) => {
        if (!value) onStepDown.current?.();
        setClaim({ actorId, roundId, owns: value });
      },
    });
    lifetime.current = current;
    const release = () => current.stop();
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      current.stop();
      lifetime.current = null;
    };
  }, [actorId, roundId]);
  const takeOver = useCallback(() => lifetime.current?.takeOver(), []);
  return { owns, takeOver };
}
