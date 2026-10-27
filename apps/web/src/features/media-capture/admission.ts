import { createAppError } from '@daisy/errors';

/** The signed media-worker identity under one capture lease epoch. */
export type CaptureIdentity = {
  readonly roundId: string;
  readonly sessionId: string;
  readonly workerId: string;
  readonly epoch: number;
};
export type CaptureRead = {
  readonly serverNow: string;
  readonly segment: {
    readonly id: string;
    readonly endedAt: string | null;
  } | null;
  readonly participants: readonly {
    readonly roundParticipantId: string;
    readonly kind: string;
    readonly identity: string | null;
  }[];
};
export type LeaseRead = (
  identity: CaptureIdentity & { readonly segmentId: string },
) => Promise<{ readonly serverNow: string }>;

/** An actually bound seat (of `kind`, when named) and the current open segment. */
export function requireCurrentSeat(
  capture: CaptureRead,
  roundParticipantId: string,
  segmentId: string,
  kind?: 'bot',
) {
  if (
    !capture.participants.some(
      (seat) =>
        seat.roundParticipantId === roundParticipantId &&
        seat.identity !== null &&
        (kind === undefined || seat.kind === kind),
    )
  )
    throw createAppError('AUTHORIZATION');
  if (capture.segment?.id !== segmentId || capture.segment.endedAt !== null)
    throw createAppError('CONFLICT', 'Activity segment is not current');
}
