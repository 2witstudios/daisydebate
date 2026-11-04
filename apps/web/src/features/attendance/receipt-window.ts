import { availabilityOf } from './availability-of';
import { requireAttendanceWindow } from '@daisy/debate-engine';
import { createRefusal, isAppError } from '@daisy/errors';
import { attendanceTimingPolicy } from '@daisy/protocol';
import type { LockedAttendanceCheckIn } from '@daisy/db/attendance';
import { attendanceWindowFor } from './windows';
import { attendanceReceiptTime } from './receipt-time';

export function acceptAttendanceReceipt(
  facts: LockedAttendanceCheckIn,
  segmentId: string,
): void {
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
