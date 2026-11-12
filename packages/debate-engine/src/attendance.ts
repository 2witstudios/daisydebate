import { createInvariantError } from '@daisy/errors';
import type {
  AttendanceAdjudicationFact,
  DebateSide,
  HydratedSegment,
  RoundRules,
} from '@daisy/protocol';
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

/** What settled evidence proved a window on: its deadline and how far health was known. */
type SettledOn = {
  readonly evidence: 'settled_availability';
  readonly effectiveDeadlineMs: number;
  /** The horizon the evidence was settled through, which the stored fact keeps. */
  readonly settledHorizonMs: number;
};

/** Why a decision holds. Positive evidence needs no health history; absence always does. */
export type AttendanceDecision =
  | {
      readonly evidence: 'on_time_receipt';
      readonly decision: 'attended';
      readonly participantId: string;
      /** The receipt's own instant: the stored fact names the receipt, which holds it. */
      readonly receivedAtMs: number;
    }
  | (SettledOn & { readonly decision: 'attended' | 'none' })
  | (SettledOn & { readonly decision: 'abandoned' })
  | (SettledOn & {
      readonly decision: 'forfeit';
      /** The Round's outcome: the projection stores it, the adjudication row does not. */
      readonly winner: DebateSide;
    })
  /** Settled evidence never came and the cutoff passed (DEC-276). */
  | {
      readonly evidence: 'resolution_cutoff';
      readonly decision: 'abandoned';
    };
/**
 * The instant settled evidence stops being waited for: the debate's closed end
 * plus the policy (DEC-276), null until its last segment has closed. The
 * decision and its check both read this, so they cannot disagree, and a Round
 * whose last segment is still open waits for the clock to close it.
 */
export const resolutionCutoffOf = (
  rules: Pick<RoundRules, 'segments'>,
  segments: readonly Pick<HydratedSegment, 'sequence' | 'endedAt'>[],
): number | null => {
  const last = segments.find((s) => s.sequence === rules.segments.length - 1);
  return last?.endedAt
    ? Date.parse(last.endedAt) + attendancePolicy.resolutionCutoffMs
    : null;
};

/** The decisions that end a Round. */
export type RoundEndingDecision = Extract<
  AttendanceDecision,
  { decision: 'forfeit' | 'abandoned' }
>;
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
        }
      : null;
  const settled: SettledOn = {
    evidence: 'settled_availability',
    effectiveDeadlineMs,
    settledHorizonMs: availability.settledHorizonMs,
  };
  return controlledDecision(
    input,
    decisionForStamps(window, input.checkIns, settled),
    settled,
  );
}

/**
 * The stored fact a decision is recorded as: one total mapping, so the adapter
 * never assembles a row the evidence constraint refuses. Instants are written
 * by `instant`, which keeps the database's microseconds.
 */
export const adjudicationFactOf = (
  segmentId: string,
  decision: AttendanceDecision,
  instant: (atMs: number) => string,
): AttendanceAdjudicationFact => {
  switch (decision.evidence) {
    case 'on_time_receipt':
      return {
        segmentId,
        evidence: decision.evidence,
        decision: decision.decision,
        receiptParticipantId: decision.participantId,
      };
    case 'resolution_cutoff':
      return {
        segmentId,
        evidence: decision.evidence,
        decision: decision.decision,
      };
    case 'settled_availability':
      return {
        segmentId,
        evidence: decision.evidence,
        decision: decision.decision,
        effectiveDeadline: instant(decision.effectiveDeadlineMs),
        settledHorizon: instant(decision.settledHorizonMs),
      };
  }
};

/** A bot's missing receipt is worker loss, never absence: a decision it would change abandons. */
function controlledDecision(
  input: {
    readonly window: AttendanceWindow;
    readonly checkIns: readonly AttendanceStamp[];
    readonly botSeatIds: readonly string[];
  },
  decision: SettledDecision,
  settled: SettledOn,
): SettledDecision {
  const present = presentSeats(
    input.window,
    input.checkIns,
    settled.effectiveDeadlineMs,
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
    settled,
  );
  return ifPresent.decision === decision.decision &&
    (ifPresent.decision !== 'forfeit' ||
      (decision.decision === 'forfeit' && ifPresent.winner === decision.winner))
    ? decision
    : { ...settled, decision: 'abandoned' };
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
  settled: SettledOn,
): SettledDecision {
  const { effectiveDeadlineMs } = settled;
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
