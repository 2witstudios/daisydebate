import '../../lib/zod-jitless';
import { z } from 'zod';
import { mayResumeTab, type ResumeOwnership } from './resume';

/**
 * Advisory ownership for one resume across tabs (ISSUE-879): purely
 * best-effort coordination, never authority — the room page's fresh server
 * authorization governs every entry. A claim is fresh while its owner
 * heartbeats; a crashed or closed tab's claim goes stale after the grace, so
 * another tab may take over. No claim denies resume forever.
 */
export const resumeOwnershipHeartbeatMs = 2500;

export const resumeOwnershipPrefix = 'daisy:resume-owner:';
export const resumeOwnershipKey = (actorId: string, roundId: string) =>
  `${resumeOwnershipPrefix}${actorId}:${roundId}`;

/** Tab-local name of the document whose claim the tab's next document inherits. */
export const resumeHeirPrefix = 'daisy:resume-heir:';
export const resumeHeirKey = (actorId: string, roundId: string) =>
  `${resumeHeirPrefix}${actorId}:${roundId}`;

const ownershipSchema = z.strictObject({
  owner: z.string().min(1),
  claimedAtMs: z.number().int().nonnegative(),
  left: z.literal(true).optional(),
});

const parseClaim = (raw: string | null): ResumeOwnership | null => {
  if (raw === null) return null;
  try {
    const parsed = ownershipSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
};

/** Reads and validates the stored claim; anything else reads as unowned. */
export function readOwnership(
  storage: Pick<Storage, 'getItem'>,
  actorId: string,
  roundId: string,
): ResumeOwnership {
  try {
    return (
      parseClaim(storage.getItem(resumeOwnershipKey(actorId, roundId))) ?? {
        owner: null,
        claimedAtMs: null,
      }
    );
  } catch {
    return { owner: null, claimedAtMs: null };
  }
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
  if (held.owner !== input.tabId || held.left) return;
  claimOwnership(input);
}

/**
 * The holder says it left, in its own claim: a waiting tab must not inherit the
 * Round (ISSUE-1033). A tab holding nothing says nothing, so leaving from a
 * waiting tab never costs the holder its recovery. Nothing outlives the claim.
 */
export function markClaimLeft(input: {
  readonly storage: Pick<Storage, 'getItem' | 'setItem'>;
  readonly actorId: string;
  readonly roundId: string;
  readonly tabId: string;
}): void {
  const held = readOwnership(input.storage, input.actorId, input.roundId);
  if (held.owner !== input.tabId) return;
  try {
    input.storage.setItem(
      resumeOwnershipKey(input.actorId, input.roundId),
      JSON.stringify({ ...held, left: true }),
    );
  } catch {
    // Storage disabled: coordination is impossible.
  }
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

/** A claim a dead tab stranded must not outlive its staleness; other Rounds' included. */
export function sweepExpiredClaims(
  storage: Pick<Storage, 'length' | 'key' | 'getItem' | 'removeItem'>,
  nowMs: number,
): void {
  try {
    const expired: string[] = [];
    for (let index = 0; index < storage.length; index++) {
      const key = storage.key(index);
      if (!key?.startsWith(resumeOwnershipPrefix)) continue;
      const claim = parseClaim(storage.getItem(key));
      if (!claim || mayResumeTab('', claim, nowMs) === 'take-over')
        expired.push(key);
    }
    for (const key of expired) storage.removeItem(key);
  } catch {
    // Storage disabled: nothing was stranded here.
  }
}
