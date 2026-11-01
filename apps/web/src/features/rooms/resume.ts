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

export const resumeOwnershipStaleMs = 5000;
export type ResumeOwnership = {
  readonly owner: string | null;
  readonly claimedAtMs: number | null;
};

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
    nowMs >= ownership.claimedAtMs &&
    nowMs - ownership.claimedAtMs < resumeOwnershipStaleMs;
  if (!fresh) return 'take-over';
  return ownership.owner === tabId ? 'resume' : 'defer';
}
