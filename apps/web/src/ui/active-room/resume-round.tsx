'use client';

import type { ActiveRoom } from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import { useEffect } from 'react';
import { departedInSession } from '../../features/round-media/media-preferences';
import { resumeRoundHrefOf } from '../../features/rooms/resume';
import {
  claimOwnership,
  markResumedOnce,
  mayResumeTab,
  readOwnership,
  resumedInThisTab,
  subscribeOwnership,
  tabIdOf,
} from '../../features/rooms/resume-ownership';

/** Round id inside the signed href, when the Round actually launched. */
export const roundIdOf = (href: string): string | null => {
  const matched = /\/rounds\/([a-z0-9]{24})\/room$/.exec(href);
  return matched?.[1] ?? null;
};

type ActiveRoomRef = Pick<ActiveRoom, 'phase' | 'href'>;

const now = () => Date.parse(systemClock.now());
const randomTabId = () =>
  window.crypto?.randomUUID?.() ?? `tab-${now()}-advisory-no-secret`;

/**
 * Home and the Lobby continue a launched Round that holds the member with
 * one canonical hop to the room page's already-valid href (ISSUE-879). The
 * same tested decision (`resumeRoundHrefOf`) governs eligibility, the room
 * page authorizes its own audience there, and this browser session's
 * explicit departure suppresses the hop. Tab coordination is advisory only:
 * a deferred tab wakes on the storage event and on visibility, takes over a
 * stale claim, and never loops a tab that already resumed once.
 */
export function ResumeRound({
  room,
  actorId,
}: {
  readonly room: ActiveRoomRef | null;
  readonly actorId: string | null;
}) {
  useEffect(() => {
    if (room === null || actorId === null) return;
    const roundId = roundIdOf(room.href);
    if (roundId === null) return;
    const href = resumeRoundHrefOf({
      actorId,
      room,
      departed: departedInSession(actorId, roundId),
    });
    if (href === null) return;
    const session = window.sessionStorage;
    const storage = window.localStorage;
    if (resumedInThisTab(session, actorId, roundId)) return;
    const tabId = tabIdOf(session, randomTabId);
    const attempt = (): boolean => {
      const taken = mayResumeTab(
        tabId,
        readOwnership(storage, actorId, roundId),
        now(),
      );
      if (taken === 'defer') return false;
      claimOwnership({
        storage,
        actorId,
        roundId,
        tabId,
        nowMs: now(),
      });
      markResumedOnce(session, actorId, roundId);
      window.location.replace(href);
      return true;
    };
    let resumed = attempt();
    if (resumed) return;
    // A deferred tab re-checks when its yield ends: the owner released or
    // crashed (storage event), or this tab becomes visible again.
    const wake = () => {
      if (!resumed) resumed = attempt();
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake();
    };
    const unsubscribe = subscribeOwnership(window, actorId, roundId, wake);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      unsubscribe();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [room, actorId]);
  return null;
}
