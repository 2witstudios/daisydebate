import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import { createAppError } from '@daisy/errors';
import { eligibleCompetitorIds } from '@daisy/protocol/seats';
import type { AttendanceEnvelope } from '@daisy/protocol/attendance';
import type {
  AttendanceDiscoverySession,
  AttendanceReceiptSession,
  AttendancePrincipal,
  AttendanceStore,
} from '@daisy/db/attendance';
import {
  requireAttendanceRound,
  requireCheckInSegment,
  selectAttendanceSeat,
} from './admission';
import { acceptAttendanceReceipt } from './receipt-window';

/** One owner for human receipts and the bot controller's discovery/receipt flow. */
async function admit(
  session: AttendanceDiscoverySession | AttendanceReceiptSession,
  principal: AttendancePrincipal,
) {
  requireAttendanceRound(session.authority.round);
  const seats = await session.readSeats();
  if (
    principal.kind === 'human' &&
    (!session.authority.principalAccess ||
      !admitsPrincipalAccess(session.authority.principalAccess))
  )
    throw createAppError('AUTHORIZATION');
  const seat = selectAttendanceSeat(principal, seats);
  if (principal.kind === 'agent') await session.verifyWorker();
  return {
    seat,
    round: session.authority.round,
    eligibleParticipantIds: eligibleCompetitorIds(seats),
  };
}

export const readAttendanceDiscovery = (
  store: AttendanceStore,
  principal: AttendancePrincipal,
  roundId: string,
) =>
  store.withAttendanceDiscovery({ principal, roundId }, async (session) => {
    const { seat, ...facts } = await admit(session, principal);
    const finalizedSegmentIds = await session.readAdjudicatedSegments();
    const undecided = facts.round.segments.find(
      (segment) =>
        segment.type === 'speech' && !finalizedSegmentIds.includes(segment.id),
    );
    const samples = await session.readSamples(undecided?.startedAt ?? null);
    const recorded = await session.readRecorded(seat.id);
    return {
      ...facts,
      participantId: seat.id,
      finalizedSegmentIds,
      samples,
      ...recorded,
    };
  });

export const recordAttendanceReceipt = (
  store: AttendanceStore,
  input: {
    readonly principal: AttendancePrincipal;
    readonly roundId: string;
    readonly envelope: AttendanceEnvelope;
    readonly payloadDigest: string;
  },
) =>
  store.withAttendanceReceipt(input, async (session) => {
    const { seat, ...facts } = await admit(session, input.principal);
    const finalizedSegmentIds = await session.readClosedSegments();
    const segment = requireCheckInSegment(
      facts.round.segments,
      input.envelope.segmentId,
      finalizedSegmentIds,
    );
    const samples = await session.readSamples(segment.startedAt);
    const window = {
      ...facts,
      participantId: seat.id,
      finalizedSegmentIds,
      samples,
    };
    const replay = await session.replay(seat.id);
    if (replay) {
      acceptAttendanceReceipt(
        { ...window, receivedAt: replay.receivedAt },
        segment.id,
      );
      return;
    }
    const stamp = await session.prepareReceipt(seat.id);
    acceptAttendanceReceipt({ ...window, ...stamp }, segment.id);
    await session.apply();
  });
