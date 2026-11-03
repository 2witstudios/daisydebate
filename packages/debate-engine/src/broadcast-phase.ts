import type { BroadcastFacts } from './broadcast-lifecycle';

export type PhasePosition = {
  readonly status: string;
  readonly openSegment: { readonly endsAt: string } | null;
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
): BroadcastFacts['phase'] => {
  if (
    position.status !== 'active' ||
    position.prep ||
    position.stage === 'awaiting_ballot'
  )
    return { kind: 'private' };
  if (position.openSegment)
    return position.nextSegment
      ? { kind: 'public' }
      : { kind: 'private-at', atMs: Date.parse(position.openSegment.endsAt) };
  return position.nextSegment ? { kind: 'public' } : { kind: 'private' };
};
