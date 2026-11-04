import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import {
  createRoundRuntime,
  adjudicateAttendance,
  nextAttendanceSegment,
  type RoundEndingDecision,
  onTimeSpeakerReceipt,
  requireAttendanceDecision,
  resolutionCutoffOf,
  effectiveAttendanceDeadline,
  judgingEndIsReported,
  judgingJobEndReason,
} from '@daisy/debate-engine';
import type {
  AttendanceStore,
  AttendanceEvaluator,
  AttendanceEvaluationFacts,
  AttendanceReceiptFacts,
  AttendanceResolution,
  AttendancePrincipal,
} from '@daisy/db/attendance';
import {
  attendanceEnvelopeSchema,
  attendanceTimingPolicy,
  type AttendanceEnvelope,
  type JudgingTerminalReason,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { acceptAttendanceReceipt } from './receipt-window';
import { availabilityOf } from './availability-of';
import { attendanceWindowFor } from './windows';
import { attendanceReceiptTime, attendanceTimestamp } from './receipt-time';
const windowOf = (facts: AttendanceReceiptFacts) => {
  const target = nextAttendanceSegment({
    ruleSegments: facts.round.rules.segments,
    segments: facts.round.segments,
    finalizedSegmentIds: facts.finalizedSegmentIds,
  });
  if (!target) return null;
  return {
    target,
    window: attendanceWindowFor(
      facts.round,
      target.id,
      facts.eligibleParticipantIds,
    ),
    checkIns: facts.checkIns
      .filter((stamp) => stamp.segmentId === target.id)
      .map((stamp) => ({
        participantId: stamp.participantId,
        receivedAtMs: attendanceReceiptTime(stamp.receivedAt),
      })),
  };
};
/** An on-time speaker settles the window with no availability history at all. */
function resolveOnTimeReceipt(
  facts: AttendanceReceiptFacts,
): AttendanceResolution | null {
  const next = windowOf(facts);
  const credited = next && onTimeSpeakerReceipt(next);
  return credited
    ? {
        segmentId: next.target.id,
        evidence: 'on_time_receipt',
        decision: 'attended',
        receiptParticipantId: credited.participantId,
        projection: null,
      }
    : null;
}
/**
 * Actual ordered openings, current eligible seats, durable stamps and settled
 * evidence are the only inputs. The engine decides, and the same evidence
 * verifies it. Unknown health postpones and forfeits nobody; past the persisted
 * cutoff it ends the Round with no winner (DEC-276).
 */
function resolveAttendanceWindow(
  facts: AttendanceEvaluationFacts,
  nextSegmentId: () => string,
): AttendanceResolution | null {
  const next = windowOf(facts);
  if (!next) return null;
  const { target, window, checkIns } = next;
  const availability = availabilityOf(facts);
  const evidence = {
    window,
    availability,
    checkIns,
    botSeatIds: facts.botSeatIds,
    finalized: false,
    segmentType: target.type,
    cutoffAtMs: resolutionCutoffOf(facts.round.rules, facts.round.segments),
    nowMs: Date.parse(facts.now),
  };
  const decision = adjudicateAttendance(evidence);
  if (!decision) return null;
  requireAttendanceDecision(evidence, decision);
  const projectionOf = (ending: RoundEndingDecision) =>
    createRoundRuntime({
      round: facts.round,
      rules: facts.round.rules,
      participants: facts.round.participants,
      checkpoint: facts.round.checkpoint,
      segments: facts.round.segments,
      nextSegmentId,
    }).adjudicate({ segmentId: target.id, decision: ending, now: facts.now });
  if (decision.evidence === 'on_time_receipt')
    return {
      segmentId: target.id,
      evidence: 'on_time_receipt',
      decision: 'attended',
      receiptParticipantId: decision.participantId,
      projection: null,
    };
  if (decision.evidence === 'resolution_cutoff')
    return {
      segmentId: target.id,
      evidence: 'resolution_cutoff',
      decision: 'abandoned',
      projection: projectionOf(decision),
    };
  const { effectiveDeadlineMs } = decision;
  return {
    segmentId: target.id,
    evidence: 'settled_availability',
    decision: decision.decision,
    effectiveDeadline: attendanceTimestamp(effectiveDeadlineMs),
    // Non-null: the engine decided on settled evidence.
    settledHorizon: attendanceTimestamp(availability.settledHorizonMs!),
    projection:
      decision.decision === 'forfeit' || decision.decision === 'abandoned'
        ? projectionOf(decision)
        : null,
  };
}

export function createAttendanceFeature(deps: {
  readonly checkIns: AttendanceStore;
  readonly evaluate: AttendanceEvaluator;
  readonly nextId: () => string;
  readonly instanceId: string;
  readonly judgingEnded?: (reason: JudgingTerminalReason) => void;
}) {
  const readState = async (principal: AttendancePrincipal, roundId: string) => {
    const facts = await deps.checkIns.readRoundAttendanceTargets({
      principal,
      roundId,
      admits: admitsPrincipalAccess,
    });
    const nowMs = Date.parse(facts.now);
    const availability = availabilityOf(facts);
    const targets = facts.round.segments
      .filter(
        (segment) =>
          segment.type === 'speech' &&
          !facts.finalizedSegmentIds.includes(segment.id) &&
          !facts.receipts.some((receipt) => receipt.segmentId === segment.id),
      )
      .flatMap((segment) => {
        const window = attendanceWindowFor(
          facts.round,
          segment.id,
          facts.eligibleParticipantIds,
        );
        const deadlineMs = effectiveAttendanceDeadline({
          openedAtMs: window.openedAtMs,
          graceMs: attendanceTimingPolicy.graceMs,
          availability,
        });
        return nowMs >= window.openedAtMs - attendanceTimingPolicy.leadMs &&
          (deadlineMs === null || nowMs <= deadlineMs)
          ? [
              {
                segmentId: segment.id,
                openedAt: segment.startedAt,
                effectiveDeadline:
                  deadlineMs === null ? null : attendanceTimestamp(deadlineMs),
              },
            ]
          : [];
      });

    return { roundId, recorded: facts.receipts, targets };
  };
  return {
    targets: async (principal: AttendancePrincipal, roundId: string) =>
      (await readState(principal, roundId)).targets,
    nativeState: async (principal: AttendancePrincipal, roundId: string) => {
      const state = await readState(principal, roundId);
      return {
        ...state,
        targets: state.targets.map((target) => ({
          ...target,
          commandId: deps.nextId(),
        })),
      };
    },
    async checkIn(
      principal: AttendancePrincipal,
      roundId: string,
      raw: AttendanceEnvelope,
    ) {
      const parsed = attendanceEnvelopeSchema.safeParse(raw);
      if (!parsed.success) throw createAppError('VALIDATION');
      const envelope = parsed.data;
      return deps.checkIns.recordRoundCheckIn({
        roundId,
        principal,
        envelope,
        payloadDigest: new Bun.CryptoHasher('sha3-256')
          .update(JSON.stringify(envelope))
          .digest('hex'),
        acceptWindow: (facts) =>
          acceptAttendanceReceipt(facts, envelope.segmentId),
        // ADR 0075: a human checks in only with participant access.
        admits: admitsPrincipalAccess,
      });
    },
    evaluate: (roundId: string) =>
      deps.evaluate({
        roundId,
        commandId: deps.nextId(),
        instanceId: deps.instanceId,
        nextWindow: nextAttendanceSegment,
        judgingEndReason: judgingJobEndReason,
        judgingEnded: (reason) => {
          if (judgingEndIsReported(reason)) deps.judgingEnded?.(reason);
        },
        resolveOnReceipts: resolveOnTimeReceipt,
        resolve: (facts) => resolveAttendanceWindow(facts, deps.nextId),
      }),
  };
}

export type NativeAttendanceState = Awaited<
  ReturnType<ReturnType<typeof createAttendanceFeature>['nativeState']>
>;
