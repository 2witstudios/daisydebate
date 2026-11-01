'use client';

import type { ActiveRoom } from '@daisy/protocol';
import { systemClock } from '@daisy/clock';
import { useEffect } from 'react';
import { departedInSession } from '../../features/round-media/media-preferences';
import {
  mayResumeTab,
  type ResumeOwnership,
} from '../../features/rooms/resume';

/** Round id inside the signed href, when the Round actually launched. */
export const roundIdOf = (href: string): string | null => {
  const matched = /\/rounds\/([a-z0-9]{24})\/room$/.exec(href);
  return matched?.[1] ?? null;
};

type ActiveRoomRef = Pick<ActiveRoom, 'href'>;

const ownershipKey = (roomId: string) => `daisy:resume-owner:${roomId}`;
const readOwnership = (roomId: string): ResumeOwnership | null => {
  try {
    const raw = window.localStorage.getItem(ownershipKey(roomId));
    if (raw === null) return null;
    const parsed = JSON.parse(raw) as unknown;
    return parsed !== null && typeof parsed === 'object'
      ? (parsed as ResumeOwnership)
      : null;
  } catch {
    return null;
  }
};
const writeOwnership = (roomId: string, tabId: string, nowMs: number) => {
  try {
    window.localStorage.setItem(
      ownershipKey(roomId),
      JSON.stringify({ owner: tabId, claimedAtMs: nowMs }),
    );
  } catch {
    // Storage disabled: the advisory cannot exist; the resume still runs.
  }
};

/**
 * Home and the Lobby continue a launched Round that holds the member with
 * one canonical hop to the room page's already-valid href (ISSUE-879). No
 * server-side redirect: the target route authorizes its own audience, and
 * the continuation is suppressed when this browser session departed the
 * Round explicitly. A claim is advisory only: tabs coordinate per resume,
 * with a crashed tab's stale claim decided by the pure mayResumeTab grace.
 */
export function ResumeRound({
  room,
  actorId,
}: {
  readonly room: ActiveRoomRef | null;
  readonly actorId: string | null;
}) {
  useEffect(() => {
    if (!room || actorId === null) return;
    const roundId = roundIdOf(room.href);
    if (roundId === null || departedInSession(actorId, roundId)) return;
    const nowMs = Date.parse(systemClock.now());
    const tabId =
      window.crypto?.randomUUID?.() ?? `${nowMs}-advisory-only-tabid-no-secret`;
    if (mayResumeTab(tabId, readOwnership(roundId), nowMs) === 'defer') return;
    writeOwnership(roundId, tabId, nowMs);
    // The continuation replaces this route once; the room page's own fresh
    // audience guard stays in charge there, and an explicit departure in this
    // browser session already suppressed the continuation.
    window.location.replace(room.href);
  }, [room, actorId]);
  return null;
}
