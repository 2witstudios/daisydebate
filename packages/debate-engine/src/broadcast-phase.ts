import type { RoundStage, RoundStatus, SegmentType } from '@daisy/protocol';
import type { BroadcastFacts } from './broadcast-lifecycle';

type Publicity = 'public' | 'private';

/**
 * Every stage and segment type states whether the audience may see it, here alone,
 * and these records make a new one a compile error until it does. Anything these do
 * not name, such as a future incident pause reaching a stale reader, is private.
 */
const STAGE_PUBLICITY: Readonly<Record<RoundStage, Publicity>> = {
  countdown: 'public',
  prep: 'private',
  live: 'public',
  awaiting_ballot: 'private',
};
const SEGMENT_PUBLICITY: Readonly<Record<SegmentType, Publicity>> = {
  speech: 'public',
  cross_ex: 'public',
};
const declaredPublic = (
  table: Readonly<Record<string, Publicity>>,
  name: string | null,
) => name !== null && Object.hasOwn(table, name) && table[name] === 'public';

export type PhasePosition = {
  readonly status: RoundStatus;
  readonly openSegment: {
    readonly type: string;
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
    !declaredPublic(STAGE_PUBLICITY, position.stage) ||
    (position.openSegment &&
      !declaredPublic(SEGMENT_PUBLICITY, position.openSegment.type))
  )
    return { kind: 'private' };
  // An open segment's `nextSegment` is always null, so it cannot say which is last.
  if (position.openSegment)
    return position.openSegment.sequence < lastSequence
      ? { kind: 'public' }
      : { kind: 'private-at', atMs: Date.parse(position.openSegment.endsAt) };
  return position.nextSegment ? { kind: 'public' } : { kind: 'private' };
};
