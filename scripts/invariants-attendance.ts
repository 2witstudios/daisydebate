import {
  assertAttendanceRules,
  attendancePolicy,
  deriveOutageIntervals,
  requireAttendanceWindow,
  requireAttendanceDecision,
  adjudicateAttendance,
} from '@daisy/debate-engine';
import type { RoundParticipantSeat, RoundRules } from '@daisy/protocol';

/** Actual attendance refusal fixtures used by the invariant registry gate. */
export function attendanceInvariantFixtures(
  rules: () => RoundRules,
  seats: readonly RoundParticipantSeat[],
): Readonly<Record<string, () => void>> {
  const attendanceWindow = {
    segmentId: 'actual-speech',
    openedAtMs: 0,
    speakerId: seats[0]!.id,
    speakerSide: 'affirmative' as const,
    eligibleSeats: [
      { id: seats[0]!.id, side: 'affirmative' as const },
      { id: seats[1]!.id, side: 'negative' as const },
    ],
    lastSpeech: false,
  };
  const attendanceAvailability = {
    historyStartsAtMs: 0,
    settledHorizonMs: 45000,
    intervals: [],
  };
  const attendanceApplication = (
    overrides: Partial<Parameters<typeof requireAttendanceDecision>[0]>,
  ) =>
    requireAttendanceDecision(
      {
        window: attendanceWindow,
        availability: attendanceAvailability,
        finalized: false,
        segmentType: 'speech',
        checkIns: [{ participantId: seats[0]!.id, receivedAtMs: 40000 }],
        ...overrides,
      },
      { decision: 'forfeit', winner: 'negative', effectiveDeadlineMs: 40000 },
    );
  return {
    'attendance-failure-postpones-only': () =>
      attendanceApplication({
        availability: { ...attendanceAvailability, settledHorizonMs: 44999 },
      }),
    'attendance-timestamp-decides': () => attendanceApplication({}),
    'attendance-speech-turns-only': () =>
      attendanceApplication({ segmentType: 'prep' }),
    'attendance-last-speech-never-forfeits': () =>
      attendanceApplication({
        window: { ...attendanceWindow, lastSpeech: true },
      }),

    'grace-covers-reconnect': () =>
      assertAttendanceRules(rules(), { ...attendancePolicy, graceMs: 39999 }),
    'speech-covers-grace': () =>
      assertAttendanceRules({
        ...rules(),
        segments: rules().segments.map((segment, i) =>
          i === 0 ? { ...segment, durationMs: 39999 } : segment,
        ),
      }),
    'finalization-buffer-covers-commit': () =>
      assertAttendanceRules(rules(), {
        ...attendancePolicy,
        finalizationBufferMs: 2000,
      }),
    'settled-prefix-stable': () => {
      deriveOutageIntervals([
        { atMs: 0, healthy: true },
        { atMs: 0, healthy: false },
      ]);
    },
    'check-in-window-open': () =>
      requireAttendanceWindow({
        window: attendanceWindow,
        availability: attendanceAvailability,
        receivedAtMs: 0,
        finalized: true,
        terminal: false,
      }),
    'attendance-finalized-irreversible': () => {
      adjudicateAttendance({
        window: attendanceWindow,
        availability: attendanceAvailability,
        checkIns: [],
        finalized: true,
      });
    },
  };
}
