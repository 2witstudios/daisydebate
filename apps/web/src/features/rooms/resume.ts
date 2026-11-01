import type { ActiveRoom } from '@daisy/protocol';

/**
 * Confirming the returned member's eligibility to auto-resume their live
 * Round (ISSUE-879). The read already validated membership and the
 * canonical href server-side; resume takes that signed path only when an
 * explicit departure this session does not suppress it.
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
 * Advisory ownership for a resume across tabs (ISSUE-879): a crashed tab's
 * claim goes stale, so another tab becomes owner; no claim denies resume.
 */
export const resumeOwnershipStaleMs = 5000;
export type ResumeOwnership = {
  readonly owner: string | null;
  readonly claimedAtMs: number | null;
};

/**
 * Whether this tab may resume: it owns no response when another tab holds a
 * fresh claim, and takes over a stale claim itself.
 */
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
