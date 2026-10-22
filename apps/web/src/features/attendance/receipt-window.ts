import {
  requireAttendanceWindow,
  deriveOutageIntervals,
} from '@daisy/debate-engine';
import { createAppError, isAppError } from '@daisy/errors';
import { attendanceTimingPolicy } from '@daisy/protocol';
import type { LockedAttendanceCheckIn } from '@daisy/db';
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
      availability: deriveOutageIntervals(
        facts.samples.map((s) => ({
          atMs: Date.parse(s.at),
          healthy: s.healthy,
        })),
      ),
      finalized: facts.finalizedSegmentIds.includes(segmentId),
      terminal: facts.round.status !== 'active',
    });
  } catch (error) {
    if (
      !isAppError(error) ||
      error.invariantId !== 'debate.check-in.window-open'
    )
      throw error;
    throw createAppError(
      'CONFLICT',
      receivedAtMs < window.openedAtMs - attendanceTimingPolicy.leadMs
        ? 'attendance-too-early'
        : 'attendance-window-closed',
    );
  }
}
