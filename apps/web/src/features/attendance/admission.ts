import { createAppError, createRefusal } from '@daisy/errors';
import { isDebatingSeat, type SeatRef } from '@daisy/protocol/seats';
import { roundStatus } from '@daisy/protocol/round';
import type { AttendancePrincipal } from '@daisy/db/attendance';

export function requireAttendanceRound(round: { readonly status: string }) {
  if (round.status !== roundStatus.active)
    throw createRefusal('CONFLICT', 'attendance-terminal');
}

type Seat = {
  readonly id: string;
  readonly actorId: string;
  readonly seat: SeatRef;
  readonly kind: 'human' | 'bot';
  readonly eligible: boolean;
};

/**
 * A human checks in for their own eligible debating seat; a bot only through
 * its own run's service identity. The bot's run lease is verified separately.
 */
export function selectAttendanceSeat<S extends Seat>(
  principal: AttendancePrincipal,
  seats: readonly S[],
): S {
  const seat = seats.find((candidate) =>
    principal.kind === 'human'
      ? candidate.actorId === principal.actorId
      : candidate.id === principal.participantId,
  );
  if (!seat?.eligible || !isDebatingSeat(seat.seat))
    throw createAppError('AUTHORIZATION');
  const expected = principal.kind === 'human' ? 'human' : 'bot';
  if (
    seat.kind !== expected ||
    (principal.kind === 'agent' &&
      principal.serviceId !== `agent-run:${principal.agentRunId}`)
  )
    throw createAppError('AUTHORIZATION');
  return seat;
}

/** Check-ins name a speech segment whose attendance is not yet adjudicated. */
export function requireCheckInSegment<
  S extends { readonly id: string; readonly type: string },
>(segments: readonly S[], segmentId: string, finalized: readonly string[]): S {
  const segment = segments.find((candidate) => candidate.id === segmentId);
  if (!segment || segment.type !== 'speech')
    throw createRefusal('CONFLICT', 'attendance-segment');
  if (finalized.includes(segment.id))
    throw createRefusal('CONFLICT', 'attendance-finalized');
  return segment;
}
