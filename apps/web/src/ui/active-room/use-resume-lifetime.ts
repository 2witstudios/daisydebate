'use client';

import { repeatEvery } from '../edge/browser-waits';
import { resumeOwnershipHeartbeatMs } from '../../features/rooms/resume-ownership';
import { useDeliver } from '../edge/use-answer';
import { useResource } from '../edge/use-driver';
import { nowMs, systemClock } from '@daisy/clock';
import { useMemo, useState } from 'react';
import { documentTabId } from '../../features/rooms/document-tab';
import { markDeparture } from '../../features/rooms/resume-departure';
import { createResumeLifetime } from '../../features/rooms/resume-lifetime';
import {
  resumeHeirKey,
  subscribeOwnership,
} from '../../features/rooms/resume-ownership';

type ResumeCallbacks = {
  readonly holderLeft: () => void;
  readonly steppedDown: (() => void) | undefined;
};

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
    claim?.actorId === actorId && claim.roundId === roundId ? claim.owns : null;
  const claimed = useMemo(
    () => (actorId === null || roundId === null ? null : { actorId, roundId }),
    [actorId, roundId],
  );
  const lifetime = useResource(claimed, (key) => {
    if (key === null) return null;
    const { actorId, roundId } = key;
    // The owner's latest callbacks, handed over on each render below.
    let callbacks: ResumeCallbacks = { holderLeft, steppedDown };
    const current = createResumeLifetime({
      actorId,
      roundId,
      tabId: documentTabId(),
      storage: advisoryStorage(),
      predecessor: tabPredecessor(actorId, roundId),
      now: () => nowMs(systemClock),
      holderLeft: () => {
        markDeparture(actorId, roundId);
        callbacks.holderLeft();
      },
      subscribe: (listener) =>
        subscribeOwnership(window, actorId, roundId, listener),
      schedule: repeatEvery(resumeOwnershipHeartbeatMs),
      changed: (value) => {
        if (!value) callbacks.steppedDown?.();
        setClaim({ actorId, roundId, owns: value });
      },
    });
    // A frozen, restorable page stops heartbeating, so its claim expires by itself.
    const release = (event: PageTransitionEvent) => {
      if (!event.persisted) current.handOff();
    };
    window.addEventListener('pagehide', release);
    return {
      takeOver: () => current.takeOver(),
      follow: (next: ResumeCallbacks) => {
        callbacks = next;
      },
      dispose: () => {
        window.removeEventListener('pagehide', release);
        current.stop();
      },
    };
  });
  const followed = useMemo(
    () => ({ lifetime, callbacks: { holderLeft, steppedDown } }),
    [lifetime, holderLeft, steppedDown],
  );
  useDeliver(followed, (next) => next.lifetime?.follow(next.callbacks));
  const takeOver = useMemo(() => () => lifetime?.takeOver(), [lifetime]);
  return { owns, takeOver };
}
