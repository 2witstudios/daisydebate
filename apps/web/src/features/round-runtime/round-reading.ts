import type { RoundPosition } from '@daisy/debate-engine/position';
import type { DebateSide, RoundSeat, RoundView } from '@daisy/protocol';

/**
 * The one reading of a Round's people and floor (ISSUE-672) that the
 * debater room and the spectator view share, so a rule change, such as who
 * holds the floor after an accepted interruption, reaches everyone who
 * watches it the same way.
 */

type Participant = RoundView['participants'][number];

/** A debater's seat: any participant who is not the judge. */
export type Seat = RoundSeat & { role: DebateSide };

export const sideName: Readonly<Record<DebateSide, string>> = {
  affirmative: 'Affirmative',
  negative: 'Negative',
};

export const isSeat = (p: Participant): p is Seat => p.role !== 'judge';

/** A Round that has not ended: scheduled to start, or running. */
export const isLiveRound = (view: Pick<RoundView, 'status'>): boolean =>
  view.status === 'scheduled' || view.status === 'active';

/** Who holds the floor: an accepted interruption's seat, else the segment's side. */
export const floorSideOf = (
  view: Pick<RoundView, 'participants'>,
  open: Pick<
    NonNullable<RoundPosition['openSegment']>,
    'side' | 'floorParticipantId'
  >,
): DebateSide =>
  view.participants.filter(isSeat).find((p) => p.id === open.floorParticipantId)
    ?.role ?? open.side;

/** The judge's kind, never their name: an AI, a human, or no judge seat. */
export const judgeKindOf = (
  view: Pick<RoundView, 'participants'>,
): 'ai' | 'human' | null => {
  const judge = view.participants.find((p) => p.role === 'judge');
  if (!judge) return null;
  return judge.kind === 'bot' ? 'ai' : 'human';
};
