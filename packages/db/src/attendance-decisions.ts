import { createAppError } from '@daisy/errors';
import type { AttendancePrincipal } from './attendance-facts';

type Seat = {
  readonly id: string;
  readonly actorId: string;
  readonly role: string;
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
  if (!seat?.eligible || seat.role === 'judge')
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
    throw createAppError('CONFLICT', 'attendance-segment');
  if (finalized.includes(segment.id))
    throw createAppError('CONFLICT', 'attendance-finalized');
  return segment;
}

/** A replayed check-in must name the same segment and seat as its receipt. */
export function requireSameCheckIn(
  receipt: { readonly segmentId: string; readonly participantId: string },
  expected: { readonly segmentId: string; readonly participantId: string },
): void {
  if (
    receipt.segmentId !== expected.segmentId ||
    receipt.participantId !== expected.participantId
  )
    throw createAppError('CONFLICT', 'command-conflict');
}
