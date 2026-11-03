'use client';

import { systemClock } from '@daisy/clock';
import { createId } from '@paralleldrive/cuid2';
import { useCallback, useEffect, useRef, useState } from 'react';
import { clearDeparture, sweepDepartures } from './resume-departure';
import { createResumeLifetime } from './resume-lifetime';
import {
  resumeHeirKey,
  resumeOwnershipHeartbeatMs,
  subscribeOwnership,
} from './resume-ownership';

// One document identity, never sessionStorage (which a newly opened tab may clone).
let documentTabId: string | null = null;

/** Blocked storage means no coordination, which must never mean no media. */
const advisoryStorage = () => {
  try {
    return window.localStorage;
  } catch {
    return {
      length: 0,
      key: () => null,
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    };
  }
};

/** A clone made by window.open never sees this: it exists only across a navigation. */
const tabPredecessor = (actorId: string, roundId: string) => {
  const key = resumeHeirKey(actorId, roundId);
  const guarded = <T>(work: (session: Storage) => T, blocked: T): T => {
    try {
      return work(window.sessionStorage);
    } catch {
      return blocked;
    }
  };
  return {
    read: () => guarded((session) => session.getItem(key), null),
    write: (tabId: string) =>
      guarded((session) => session.setItem(key, tabId), undefined),
    clear: () => guarded((session) => session.removeItem(key), undefined),
  };
};

export function useResumeLifetime(
  actorId: string | null,
  roundId: string | null,
  steppedDown?: () => void,
  departed: (actorId: string, roundId: string) => boolean = () => false,
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
  const holdForDeparture = useRef(departed);
  useEffect(() => {
    onStepDown.current = steppedDown;
    holdForDeparture.current = departed;
  }, [steppedDown, departed]);
  useEffect(() => {
    if (actorId === null || roundId === null) return;
    documentTabId ??= createId();
    sweepDepartures(advisoryStorage() as Storage);
    const current = createResumeLifetime({
      actorId,
      roundId,
      tabId: documentTabId,
      storage: advisoryStorage(),
      predecessor: tabPredecessor(actorId, roundId),
      now: () => Date.parse(systemClock.now()),
      departed: () => holdForDeparture.current(actorId, roundId),
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
    // A frozen, restorable page stops heartbeating, so its claim expires by itself.
    const release = (event: PageTransitionEvent) => {
      if (!event.persisted) current.handOff();
    };
    window.addEventListener('pagehide', release);
    return () => {
      window.removeEventListener('pagehide', release);
      current.stop();
      lifetime.current = null;
    };
  }, [actorId, roundId]);
  /** The person chose this tab, so any earlier departure no longer stands. */
  const takeOver = useCallback(() => {
    if (actorId !== null && roundId !== null) clearDeparture(actorId, roundId);
    lifetime.current?.takeOver();
  }, [actorId, roundId]);
  return { owns, takeOver };
}
