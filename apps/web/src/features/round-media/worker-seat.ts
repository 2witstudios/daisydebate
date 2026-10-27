import { createAppError } from '@daisy/errors';

/** What any media worker role's read shows of the Round: the open segment and the seats. */
export type WorkerSeatRead = {
  readonly segment: {
    readonly id: string;
    readonly endedAt?: string | null;
  } | null;
  readonly participants: readonly {
    readonly roundParticipantId: string;
    readonly kind: string;
    readonly identity: string | null;
  }[];
};

/**
 * The one admission rule every media worker relay applies (capture's heard
 * report, the bot listener's activity): an actually bound seat (of `kind`,
 * when named) and the current open segment.
 */
export function requireCurrentSeat(
  read: WorkerSeatRead,
  roundParticipantId: string,
  segmentId: string,
  kind?: 'bot',
) {
  if (
    !read.participants.some(
      (seat) =>
        seat.roundParticipantId === roundParticipantId &&
        seat.identity !== null &&
        (kind === undefined || seat.kind === kind),
    )
  )
    throw createAppError('AUTHORIZATION');
  if (read.segment?.id !== segmentId || (read.segment.endedAt ?? null) !== null)
    throw createAppError('CONFLICT', 'Activity segment is not current');
}
