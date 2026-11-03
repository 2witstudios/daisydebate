import type { ActiveRoom } from '@daisy/protocol';

/**
 * The returned member's eligibility to auto-resume their live Round
 * (ISSUE-879): the server read already validated membership and published
 * the canonical href and whether the member holds a seat, so this decision only
 * adds the client facts: whose session this is, whether it left, and whether this tab's last attempt never rendered.
 */
export function resumeRoundHrefOf(input: {
  readonly actorId: string | null;
  readonly room:
    Pick<ActiveRoom, 'phase' | 'href' | 'seated'> | null | undefined;
  /** The member left this Round explicitly this session. */
  readonly departed: boolean;
  /** This tab already sent them there, and the Round has not rendered since. */
  readonly attempted: boolean;
}): string | null {
  if (input.room === null || input.room === undefined) return null;
  if (input.actorId === null || input.departed || input.attempted) return null;
  return input.room.phase === 'live' && input.room.seated
    ? input.room.href
    : null;
}

export const resumeOwnershipStaleMs = 5000;
export type ResumeOwnership = {
  readonly owner: string | null;
  readonly claimedAtMs: number | null;
  /** The holder left this Round explicitly, so no waiting tab inherits it. */
  readonly left?: true;
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
