import {
  createRoundRuntime,
  deriveOutageIntervals,
  adjudicateAttendance,
  requireAttendanceDecision,
  effectiveAttendanceDeadline,
} from '@daisy/debate-engine';
import type {
  AttendanceStore,
  AttendanceEvaluator,
  AttendanceEvaluationFacts,
  AttendanceResolution,
  AttendancePrincipal,
  LockedAttendanceCheckIn,
} from '@daisy/db';
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
/** Actual ordered openings, current eligible seats, durable stamps and settled evidence are the only inputs. */
function resolveAttendanceWindow(
  facts: AttendanceEvaluationFacts,
  nextSegmentId: () => string,
): AttendanceResolution | null {
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
  const window = attendanceWindowFor(
    facts.round,
    target.id,
    facts.eligibleParticipantIds,
  );
  const availability = availabilityFor(facts);
  const evidence = {
    window,
    availability,
    checkIns: facts.checkIns
      .filter((stamp) => stamp.segmentId === target.id)
      .map((stamp) => ({
        participantId: stamp.participantId,
        receivedAtMs: attendanceReceiptTime(stamp.receivedAt),
      })),
    finalized: false,
    segmentType: target.type,
  };
  const decision = adjudicateAttendance(evidence);
  if (!decision || availability.settledHorizonMs === null) return null;
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
  const projection = terminalDecision
    ? createRoundRuntime({
        round: facts.round,
        rules: facts.round.rules,
        participants: facts.round.participants,
        checkpoint: facts.round.checkpoint,
        segments: facts.round.segments,
        nextSegmentId,
      }).adjudicate({
        segmentId: target.id,
        decision: terminalDecision,
        now: facts.now,
      })
    : null;
  return {
    segmentId: target.id,
    decision: decision.decision,
    effectiveDeadline: attendanceTimestamp(decision.effectiveDeadlineMs),
    settledHorizon: attendanceTimestamp(availability.settledHorizonMs),
    projection,
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
      });
    },
    evaluate: (roundId: string) =>
      deps.evaluate({
        roundId,
        commandId: deps.nextId(),
        instanceId: deps.instanceId,
        resolve: (facts) => resolveAttendanceWindow(facts, deps.nextId),
      }),
  };
}

export type NativeAttendanceState = Awaited<
  ReturnType<ReturnType<typeof createAttendanceFeature>['nativeState']>
>;
