import { availabilityOf } from './availability-of';
import { requireAttendanceWindow } from '@daisy/debate-engine';
import { createRefusal, isAppError } from '@daisy/errors';
import { attendanceTimingPolicy, isAbsentSeat } from '@daisy/protocol';
import type { LockedAttendanceCheckIn } from '@daisy/db/attendance';
import { attendanceWindowFor } from './windows';
import { attendanceReceiptTime } from './receipt-time';

export function acceptAttendanceReceipt(
  facts: LockedAttendanceCheckIn,
  segmentId: string,
): void {
  // A seat that left the Round is absent from then on (TAB-6.8).
  if (isAbsentSeat(facts.round.checkpoint, facts.participantId))
    throw createRefusal('CONFLICT', 'attendance-window-closed');
  const window = attendanceWindowFor(
    facts.round,
    segmentId,
    facts.eligibleParticipantIds,
  );
  const receivedAtMs = attendanceReceiptTime(facts.receivedAt);
  try {
    requireAttendanceWindow({
      window,
      receivedAtMs,
      availability: availabilityOf(facts),
      finalized: facts.finalizedSegmentIds.includes(segmentId),
      terminal: facts.round.status !== 'active',
    });
  } catch (error) {
    if (
      !isAppError(error) ||
      error.invariantId !== 'debate.check-in.window-open'
    )
      throw error;
    throw createRefusal(
      'CONFLICT',
      receivedAtMs < window.openedAtMs - attendanceTimingPolicy.leadMs
        ? 'attendance-too-early'
        : 'attendance-window-closed',
    );
  }
}
