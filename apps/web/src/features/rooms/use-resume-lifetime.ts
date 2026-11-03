'use client';

import { systemClock } from '@daisy/clock';
import { useCallback, useEffect, useRef, useState } from 'react';
import { documentTabId } from './document-tab';
import { markDeparture } from './resume-departure';
import { createResumeLifetime } from './resume-lifetime';
import {
  resumeHeirKey,
  resumeOwnershipHeartbeatMs,
  subscribeOwnership,
} from './resume-ownership';

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
  /** Where this tab goes when the tab it waited on left the Round. */
  holderLeft: () => void,
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
  const onHolderLeft = useRef(holderLeft);
  useEffect(() => {
    onStepDown.current = steppedDown;
    onHolderLeft.current = holderLeft;
  }, [steppedDown, holderLeft]);
  useEffect(() => {
    if (actorId === null || roundId === null) return;
    const current = createResumeLifetime({
      actorId,
      roundId,
      tabId: documentTabId(),
      storage: advisoryStorage(),
      predecessor: tabPredecessor(actorId, roundId),
      now: () => Date.parse(systemClock.now()),
      holderLeft: () => {
        markDeparture(actorId, roundId);
        onHolderLeft.current();
      },
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
  const takeOver = useCallback(() => lifetime.current?.takeOver(), []);
  return { owns, takeOver };
}
