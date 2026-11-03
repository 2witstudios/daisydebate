import type { BroadcastFacts } from './broadcast-lifecycle';

export type PhasePosition = {
  readonly status: string;
  readonly openSegment: {
    readonly endsAt: string;
    readonly sequence: number;
  } | null;
  readonly nextSegment: { readonly type: string } | null;
  readonly prep: { readonly side: string } | null;
  readonly stage: string | null;
};

/**
 * What the audience's stage may show. Only speech and cross-examination are
 * public; anything this cannot place as public is private, so an unknown state
 * fails closed (plan section 5).
 */
export const broadcastPhase = (
  position: PhasePosition,
  /** The sequence of the Round's last segment: only it leads to a private phase. */
  lastSequence: number,
): BroadcastFacts['phase'] => {
  if (
    position.status !== 'active' ||
    position.prep ||
    position.stage === 'awaiting_ballot'
  )
    return { kind: 'private' };
  // An open segment's `nextSegment` is always null, so it cannot say which is last.
  if (position.openSegment)
    return position.openSegment.sequence < lastSequence
      ? { kind: 'public' }
      : { kind: 'private-at', atMs: Date.parse(position.openSegment.endsAt) };
  return position.nextSegment ? { kind: 'public' } : { kind: 'private' };
};
