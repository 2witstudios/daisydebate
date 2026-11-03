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

/** Why a decision holds. Positive evidence needs no health history; absence always does. */
export type AttendanceDecision =
  | {
      readonly evidence: 'on_time_receipt';
      readonly decision: 'attended';
      readonly participantId: string;
      readonly receivedAtMs: number;
    }
  | {
      readonly evidence: 'settled_availability';
      readonly decision: 'attended' | 'none' | 'abandoned';
      readonly effectiveDeadlineMs: number;
    }
  | {
      readonly evidence: 'settled_availability';
      readonly decision: 'forfeit';
      readonly winner: DebateSide;
      readonly effectiveDeadlineMs: number;
    }
  /** Settled evidence never came and the persisted cutoff passed (DEC-276). */
  | {
      readonly evidence: 'resolution_cutoff';
      readonly decision: 'abandoned';
      readonly cutoffAtMs: number;
    };
type SettledDecision = Extract<
  AttendanceDecision,
  { evidence: 'settled_availability' }
>;

/**
 * The eligible scheduled speaker's receipt inside the base window, fixed by the
 * actual opening alone. An outage can extend the window, but only settled
 * evidence can prove that, so a later receipt never qualifies here (DEC-278).
 */
export function onTimeSpeakerReceipt(input: {
  readonly window: AttendanceWindow;
  readonly checkIns: readonly AttendanceStamp[];
}): Extract<AttendanceDecision, { evidence: 'on_time_receipt' }> | null {
  const { window, checkIns } = input;
  if (
    window.lastSpeech ||
    !window.eligibleSeats.some((seat) => seat.id === window.speakerId)
  )
    return null;
  const stamp = checkIns.find(
    ({ participantId, receivedAtMs }) =>
      participantId === window.speakerId &&
      receivedAtMs >= window.openedAtMs - attendancePolicy.leadMs &&
      receivedAtMs <= window.openedAtMs + attendancePolicy.graceMs,
  );
  return stamp
    ? {
        evidence: 'on_time_receipt',
        decision: 'attended',
        participantId: stamp.participantId,
        receivedAtMs: stamp.receivedAtMs,
      }
    : null;
}

/**
 * Durable evidence, not evaluator wall time or lock arrival, decides. Null means
 * only keep waiting. Past the cutoff a window is still decided on what its
 * history proves; only what evidence cannot decide ends the Round, with nobody
 * forfeiting (DEC-276).
 */
export function adjudicateAttendance(
  input: WindowEvidence & {
    readonly checkIns: readonly AttendanceStamp[];
    /** Seats whose presence is bot infrastructure, never a competitive choice. */
    readonly botSeatIds: readonly string[];
    readonly finalized: boolean;
    /** Null until the actual final speech has ended. */
    readonly cutoffAtMs: number | null;
    readonly nowMs: number;
  },
): AttendanceDecision | null {
  if (input.finalized)
    throw createInvariantError(
      'debate.adjudication.finalized-irreversible',
      'An attendance decision cannot be recomputed',
    );
  const { window, availability } = input;
  if (window.lastSpeech) return null;
  const onTime = onTimeSpeakerReceipt(input);
  if (onTime) return onTime;
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
    return input.cutoffAtMs !== null && input.nowMs >= input.cutoffAtMs
      ? {
          evidence: 'resolution_cutoff',
          decision: 'abandoned',
          cutoffAtMs: input.cutoffAtMs,
        }
      : null;
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
  decision: SettledDecision,
  effectiveDeadlineMs: number,
): SettledDecision {
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
    : {
        evidence: 'settled_availability',
        decision: 'abandoned',
        effectiveDeadlineMs,
      };
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
): SettledDecision {
  const settled = {
    evidence: 'settled_availability',
    effectiveDeadlineMs,
  } as const;
  if (!window.eligibleSeats.some((seat) => seat.id === window.speakerId))
    return { ...settled, decision: 'none' };
  const present = presentSeats(window, checkIns, effectiveDeadlineMs);
  if (present.has(window.speakerId))
    return { ...settled, decision: 'attended' };
  const opponentPresent = window.eligibleSeats.some(
    (seat) => seat.side !== window.speakerSide && present.has(seat.id),
  );
  if (opponentPresent)
    return {
      ...settled,
      decision: 'forfeit',
      winner: window.speakerSide === 'affirmative' ? 'negative' : 'affirmative',
    };
  const anyPresent = window.eligibleSeats.some((seat) => present.has(seat.id));
  return { ...settled, decision: anyPresent ? 'none' : 'abandoned' };
}
