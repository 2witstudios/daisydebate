import { admitsPrincipalAccess } from '@daisy/auth/authorization';
import {
  createRoundRuntime,
  deriveOutageIntervals,
  adjudicateAttendance,
  onTimeSpeakerReceipt,
  requireAttendanceDecision,
  effectiveAttendanceDeadline,
} from '@daisy/debate-engine';
import type {
  AttendanceStore,
  AttendanceEvaluator,
  AttendanceEvaluationFacts,
  AttendanceReceiptFacts,
  AttendanceResolution,
  AttendancePrincipal,
  LockedAttendanceCheckIn,
} from '@daisy/db/attendance';
import {
  attendanceEnvelopeSchema,
  attendanceTimingPolicy,
  type AttendanceEnvelope,
} from '@daisy/protocol';
import { createAppError } from '@daisy/errors';
import { acceptAttendanceReceipt } from './receipt-window';
import { attendanceWindowFor } from './windows';
import { attendanceReceiptTime, attendanceTimestamp } from './receipt-time';
const availabilityFor = (facts: Pick<LockedAttendanceCheckIn, 'samples'>) =>
  deriveOutageIntervals(
    facts.samples.map((sample) => ({
      atMs: attendanceReceiptTime(sample.at),
      healthy: sample.healthy,
    })),
  );
const windowOf = (facts: AttendanceReceiptFacts) => {
  const lastSpeech = facts.round.rules.segments
    .filter((segment) => segment.type === 'speech')
    .at(-1)?.key;
  const target = facts.round.segments.find(
    (segment) =>
      segment.type === 'speech' &&
      segment.rulesSegmentKey !== lastSpeech &&
      !facts.finalizedSegmentIds.includes(segment.id),
  );
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
 * evidence are the only inputs. Unknown health postpones and forfeits nobody;
 * past the persisted cutoff it ends the Round with no winner (DEC-276).
 */
function resolveAttendanceWindow(
  facts: AttendanceEvaluationFacts,
  nextSegmentId: () => string,
): AttendanceResolution | null {
  const next = windowOf(facts);
  if (!next) return null;
  const { target, window, checkIns } = next;
  const availability = availabilityFor(facts);
  const evidence = {
    window,
    availability,
    checkIns,
    botSeatIds: facts.botSeatIds,
    finalized: false,
    segmentType: target.type,
  };
  const runtime = () =>
    createRoundRuntime({
      round: facts.round,
      rules: facts.round.rules,
      participants: facts.round.participants,
      checkpoint: facts.round.checkpoint,
      segments: facts.round.segments,
      nextSegmentId,
    });
  const decision = adjudicateAttendance(evidence);
  if (
    !decision ||
    decision.evidence !== 'settled_availability' ||
    availability.settledHorizonMs === null
  ) {
    const cutoffAtMs = facts.resolutionCutoffAt
      ? attendanceReceiptTime(facts.resolutionCutoffAt)
      : null;
    if (cutoffAtMs === null || Date.parse(facts.now) < cutoffAtMs) return null;
    return {
      segmentId: target.id,
      evidence: 'infrastructure_unresolved',
      decision: 'abandoned',
      projection: runtime().adjudicate({
        segmentId: target.id,
        decision: { decision: 'unresolved', cutoffAtMs },
        now: facts.now,
      }),
    };
  }
  requireAttendanceDecision(evidence, decision);
  const terminalDecision =
    decision.decision === 'forfeit'
      ? decision
      : decision.decision === 'abandoned'
        ? {
            decision: 'abandoned' as const,
            effectiveDeadlineMs: decision.effectiveDeadlineMs,
          }
        : null;
  return {
    segmentId: target.id,
    evidence: 'settled_availability',
    decision: decision.decision,
    effectiveDeadline: attendanceTimestamp(decision.effectiveDeadlineMs),
    settledHorizon: attendanceTimestamp(availability.settledHorizonMs),
    projection: terminalDecision
      ? runtime().adjudicate({
          segmentId: target.id,
          decision: terminalDecision,
          now: facts.now,
        })
      : null,
  };
}

export function createAttendanceFeature(deps: {
  readonly checkIns: AttendanceStore;
  readonly evaluate: AttendanceEvaluator;
  readonly nextId: () => string;
  readonly instanceId: string;
}) {
  const readState = async (principal: AttendancePrincipal, roundId: string) => {
    const facts = await deps.checkIns.readRoundAttendanceTargets({
      principal,
      roundId,
      admits: admitsPrincipalAccess,
    });
    const nowMs = Date.parse(facts.now);
    const availability = availabilityFor(facts);
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
        resolveOnReceipts: resolveOnTimeReceipt,
        resolve: (facts) => resolveAttendanceWindow(facts, deps.nextId),
      }),
  };
}

export type NativeAttendanceState = Awaited<
  ReturnType<ReturnType<typeof createAttendanceFeature>['nativeState']>
>;
