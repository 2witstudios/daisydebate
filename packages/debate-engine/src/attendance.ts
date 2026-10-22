import { createInvariantError } from '@daisy/errors';
import type { DebateSide } from '@daisy/protocol';
import {
  effectiveAttendanceDeadline,
  type SettledAvailability,
} from './availability';

export { attendanceTimingPolicy as attendancePolicy } from '@daisy/protocol';
import { attendanceTimingPolicy as attendancePolicy } from '@daisy/protocol';

/** Derived from an actual speech row and its frozen rules speaker slot, never a media floor. */
export type AttendanceWindow = {
  readonly segmentId: string;
  readonly openedAtMs: number;
  readonly speakerId: string;
  readonly speakerSide: DebateSide;
  readonly eligibleSeats: readonly {
    readonly id: string;
    readonly side: DebateSide;
  }[];
  readonly lastSpeech: boolean;
};
export type AttendanceStamp = {
  readonly participantId: string;
  readonly receivedAtMs: number;
};
type WindowEvidence = {
  readonly window: AttendanceWindow;
  readonly availability: SettledAvailability;
};
export function requireAttendanceWindow(
  input: WindowEvidence & {
    readonly receivedAtMs: number;
    readonly finalized: boolean;
    readonly terminal: boolean;
  },
): void {
  const deadline = effectiveAttendanceDeadline({
    openedAtMs: input.window.openedAtMs,
    graceMs: attendancePolicy.graceMs,
    availability: input.availability,
  });
  if (
    input.finalized ||
    input.terminal ||
    input.receivedAtMs < input.window.openedAtMs - attendancePolicy.leadMs ||
    (deadline !== null && input.receivedAtMs > deadline)
  )
    throw createInvariantError(
      'debate.check-in.window-open',
      'Attendance receipt is outside an unresolved actual speech window',
    );
}

export type AttendanceDecision =
  | {
      readonly decision: 'attended' | 'none' | 'abandoned';
      readonly effectiveDeadlineMs: number;
    }
  | {
      readonly decision: 'forfeit';
      readonly winner: DebateSide;
      readonly effectiveDeadlineMs: number;
    };

/** The settled evidence, not evaluator wall time or lock arrival, decides absence. */
export function adjudicateAttendance(
  input: WindowEvidence & {
    readonly checkIns: readonly AttendanceStamp[];
    /** Seats whose presence is bot infrastructure, never a competitive choice. */
    readonly botSeatIds: readonly string[];
    readonly finalized: boolean;
  },
): AttendanceDecision | null {
  if (input.finalized)
    throw createInvariantError(
      'debate.adjudication.finalized-irreversible',
      'An attendance decision cannot be recomputed',
    );
  const { window, availability } = input;
  if (window.lastSpeech) return null;
  const effectiveDeadlineMs = effectiveAttendanceDeadline({
    openedAtMs: window.openedAtMs,
    graceMs: attendancePolicy.graceMs,
    availability,
  });
  if (
    effectiveDeadlineMs === null ||
    availability.settledHorizonMs === null ||
    availability.settledHorizonMs <
      effectiveDeadlineMs + attendancePolicy.finalizationBufferMs
  )
    return null;
  const decision = decisionForStamps(
    window,
    input.checkIns,
    effectiveDeadlineMs,
  );
  return controlledDecision(input, decision, effectiveDeadlineMs);
}

/** A bot's missing receipt is worker loss, never absence: a decision it would change abandons. */
function controlledDecision(
  input: {
    readonly window: AttendanceWindow;
    readonly checkIns: readonly AttendanceStamp[];
    readonly botSeatIds: readonly string[];
  },
  decision: AttendanceDecision,
  effectiveDeadlineMs: number,
): AttendanceDecision {
  const present = presentSeats(
    input.window,
    input.checkIns,
    effectiveDeadlineMs,
  );
  const absentBots = input.botSeatIds.filter(
    (id) =>
      !present.has(id) && input.window.eligibleSeats.some((e) => e.id === id),
  );
  if (absentBots.length === 0) return decision;
  const ifPresent = decisionForStamps(
    input.window,
    [
      ...input.checkIns,
      ...absentBots.map((participantId) => ({
        participantId,
        receivedAtMs: input.window.openedAtMs,
      })),
    ],
    effectiveDeadlineMs,
  );
  return ifPresent.decision === decision.decision &&
    (ifPresent.decision !== 'forfeit' ||
      (decision.decision === 'forfeit' && ifPresent.winner === decision.winner))
    ? decision
    : { decision: 'abandoned', effectiveDeadlineMs };
}

function presentSeats(
  window: AttendanceWindow,
  checkIns: readonly AttendanceStamp[],
  effectiveDeadlineMs: number,
): ReadonlySet<string> {
  return new Set(
    checkIns
      .filter(
        (stamp) =>
          stamp.receivedAtMs >= window.openedAtMs - attendancePolicy.leadMs &&
          stamp.receivedAtMs <= effectiveDeadlineMs,
      )
      .map((stamp) => stamp.participantId),
  );
}

function decisionForStamps(
  window: AttendanceWindow,
  checkIns: readonly AttendanceStamp[],
  effectiveDeadlineMs: number,
): AttendanceDecision {
  if (!window.eligibleSeats.some((seat) => seat.id === window.speakerId))
    return { decision: 'none', effectiveDeadlineMs };
  const present = presentSeats(window, checkIns, effectiveDeadlineMs);
  if (present.has(window.speakerId))
    return { decision: 'attended', effectiveDeadlineMs };
  const opponentPresent = window.eligibleSeats.some(
    (seat) => seat.side !== window.speakerSide && present.has(seat.id),
  );
  if (opponentPresent)
    return {
      decision: 'forfeit',
      winner: window.speakerSide === 'affirmative' ? 'negative' : 'affirmative',
      effectiveDeadlineMs,
    };
  const anyPresent = window.eligibleSeats.some((seat) => present.has(seat.id));
  return { decision: anyPresent ? 'none' : 'abandoned', effectiveDeadlineMs };
}
