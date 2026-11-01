import { z } from 'zod';
import type { ActiveRoom } from '@daisy/protocol';

/**
 * The returned member's eligibility to auto-resume their live Round
 * (ISSUE-879): the server read already validated membership and published
 * the canonical href, so this decision only adds the two client facts —
 * whose session this is, and whether that session left explicitly.
 */
export function resumeRoundHrefOf(input: {
  readonly actorId: string | null;
  readonly room: Pick<ActiveRoom, 'phase' | 'href'> | null | undefined;
  /** The member left this Round explicitly this session. */
  readonly departed: boolean;
}): string | null {
  if (input.room === null || input.room === undefined) return null;
  if (input.actorId === null || input.departed) return null;
  return input.room.phase === 'live' ? input.room.href : null;
}

/**
 * Advisory ownership for one resume across tabs (ISSUE-879): purely
 * best-effort coordination, never authority — the room page's fresh server
 * authorization governs every entry. A claim is fresh while its owner
 * heartbeats; a crashed or closed tab's claim goes stale after the grace, so
 * another tab may take over. No claim denies resume forever.
 */
export const resumeOwnershipStaleMs = 5000;
export const resumeOwnershipHeartbeatMs = 2500;
export type ResumeOwnership = {
  readonly owner: string | null;
  readonly claimedAtMs: number | null;
};

/** One tab's own identity, held in the tab's own session storage. */
export const tabIdOf = (
  session: Pick<Storage, 'getItem' | 'setItem'>,
  randomId: () => string,
): string => {
  const existing = session.getItem('daisy:tab-id');
  if (existing !== null && existing !== '') return existing;
  const created = randomId();
  try {
    session.setItem('daisy:tab-id', created);
  } catch {
    // Storage disabled: this tab identifies itself in memory only.
  }
  return created;
};

export const resumeOwnershipKey = (actorId: string, roundId: string) =>
  `daisy:resume-owner:${actorId}:${roundId}`;

const ownershipSchema = z.strictObject({
  owner: z.string().min(1),
  claimedAtMs: z.number().int().nonnegative(),
});

/** Reads and validates the stored claim; anything else reads as unowned. */
export function readOwnership(
  storage: Pick<Storage, 'getItem'>,
  actorId: string,
  roundId: string,
): ResumeOwnership {
  try {
    const raw = storage.getItem(resumeOwnershipKey(actorId, roundId));
    if (raw === null) return { owner: null, claimedAtMs: null };
    const parsed = ownershipSchema.safeParse(JSON.parse(raw));
    return parsed.success
      ? { owner: parsed.data.owner, claimedAtMs: parsed.data.claimedAtMs }
      : { owner: null, claimedAtMs: null };
  } catch {
    return { owner: null, claimedAtMs: null };
  }
}

/** Whether this tab may resume now: fresh foreign claim defers, else resume. */
export function mayResumeTab(
  tabId: string,
  ownership: ResumeOwnership | null,
  nowMs: number,
): 'resume' | 'defer' | 'take-over' {
  const fresh =
    ownership !== null &&
    ownership.owner !== null &&
    ownership.claimedAtMs !== null &&
    nowMs - ownership.claimedAtMs < resumeOwnershipStaleMs;
  if (!fresh) return 'take-over';
  return ownership.owner === tabId ? 'resume' : 'defer';
}

/** Writes this tab's claim; a storage-disabled tab still returns the claim. */
export function claimOwnership(input: {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly actorId: string;
  readonly roundId: string;
  readonly tabId: string;
  readonly nowMs: number;
}): void {
  try {
    input.storage.setItem(
      resumeOwnershipKey(input.actorId, input.roundId),
      JSON.stringify({ owner: input.tabId, claimedAtMs: input.nowMs }),
    );
  } catch {
    // Storage disabled: coordination is impossible, resume still proceeds.
  }
}

/** An owner reasserts its claim so a healthy, publishing tab is never stale. */
export function heartbeatOwnership(input: {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly actorId: string;
  readonly roundId: string;
  readonly tabId: string;
  readonly nowMs: number;
}): void {
  const held = readOwnership(input.storage, input.actorId, input.roundId);
  if (held.owner !== input.tabId) return;
  claimOwnership(input);
}

/** An owner steps down; a foreign or absent claim is left untouched. */
export function releaseOwnership(input: {
  readonly storage: Pick<Storage, 'getItem' | 'removeItem'>;
  readonly actorId: string;
  readonly roundId: string;
  readonly tabId: string;
}): void {
  const held = readOwnership(input.storage, input.actorId, input.roundId);
  if (held.owner !== input.tabId) return;
  try {
    input.storage.removeItem(resumeOwnershipKey(input.actorId, input.roundId));
  } catch {
    // Storage disabled: nothing held, nothing to release.
  }
}

/**
 * Wakes a deferred tab when the claim it yielded to changes or disappears,
 * and tells an owner when another tab has taken over. The storage event is
 * the browser's own cross-tab signal; same-tab writes never fire it.
 */
export function subscribeOwnership(
  window: Pick<typeof globalThis, 'addEventListener' | 'removeEventListener'>,
  actorId: string,
  roundId: string,
  listener: () => void,
): () => void {
  const key = resumeOwnershipKey(actorId, roundId);
  const onStorage = (event: unknown) => {
    const change = event as { key?: string | null } | null;
    if (change === null || change.key === null || change.key === key)
      listener();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

/** A resumed-once marker stops a back-navigation from looping the resume. */
export const resumedOnceKey = (actorId: string, roundId: string) =>
  `daisy:resume-once:${actorId}:${roundId}`;

export function markResumedOnce(
  session: Pick<Storage, 'getItem' | 'setItem'>,
  actorId: string,
  roundId: string,
): void {
  try {
    session.setItem(resumedOnceKey(actorId, roundId), '1');
  } catch {
    // Storage disabled: the loop guard degrades to the ownership claim.
  }
}

export function resumedInThisTab(
  session: Pick<Storage, 'getItem'>,
  actorId: string,
  roundId: string,
): boolean {
  try {
    return session.getItem(resumedOnceKey(actorId, roundId)) === '1';
  } catch {
    return false;
  }
}
