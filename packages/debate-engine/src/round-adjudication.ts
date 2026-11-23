import { instantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import { leadSeatOf } from '@daisy/protocol/format-seating';
import { otherSide, sameSeat, sideOfSeat } from '@daisy/protocol/seats';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import { type HydratedSegment } from '@daisy/protocol/runtime';
import { forfeitsToOpponent } from './round-outcome';
import {
  attendancePolicy,
  resolutionCutoffOf,
  type RoundEndingDecision,
} from './attendance';
import { finalSpeechKey } from './attendance-order';
import { abandonedLifecycle } from './round-clock-state';
import {
  closePlayedRound,
  completeWith,
  type StepFacts,
} from './round-commands';
import { clockOf, withLifecycle, type RoundStep } from './round-step';

export type RoundAdjudication = {
  readonly segmentId: string;
  readonly decision: RoundEndingDecision;
  readonly now: string;
};

/** The durable evaluator's verified decision, judged against the durable rows it read. */
export type RoundAdjudicationEvent = {
  readonly segmentId: string;
  readonly decision: RoundEndingDecision;
  /** The segment rows the runtime was hydrated with, which the evaluator read. */
  readonly segments: readonly HydratedSegment[];
};

const abandon = (step: RoundStep, f: StepFacts): RoundStep => {
  const closed = closePlayedRound(step, f);
  return withLifecycle(
    closed,
    abandonedLifecycle(clockOf(closed).lifecycle, f.now),
  );
};

/** Only the durable evaluator supplies a verified decision; this guards its actual runtime target. */
export function applyRoundAdjudication(
  step: RoundStep,
  f: StepFacts,
  input: RoundAdjudicationEvent,
): RoundStep {
  const { row, target } = requireActualSpeech(step, f, input);
  const { decision } = input;
  if (decision.evidence === 'resolution_cutoff') {
    requirePassedCutoff(f, input.segments);
    return abandon(step, f);
  }
  requireSettledTime(f, decision.effectiveDeadlineMs, row);
  const speaker = leadSeatOf(target.speak);
  if (
    speaker === null ||
    !step.state.cast.some((p) => sameSeat(p.seat, speaker))
  )
    throw createAppError('INVARIANT');
  if (decision.decision === 'forfeit') {
    const side = sideOfSeat(speaker);
    if (
      !forfeitsToOpponent(f.rules) ||
      side === null ||
      decision.winner !== otherSide(f.rules.sides, side)
    )
      throw createAppError('INVARIANT');
    return completeWith(
      closePlayedRound(step, f),
      f,
      winnerOutcome(decision.winner),
    );
  }
  return abandon(step, f);
}

/** Only a debate whose last segment closed has a cutoff, and only then can it pass. */
function requirePassedCutoff(
  f: StepFacts,
  segments: readonly HydratedSegment[],
): void {
  const cutoffAtMs = resolutionCutoffOf(f.rules, segments);
  if (cutoffAtMs === null || !Number.isFinite(f.now) || f.now < cutoffAtMs)
    throw createAppError('INVARIANT');
}

function requireActualSpeech(
  step: RoundStep,
  f: StepFacts,
  input: RoundAdjudicationEvent,
) {
  const row = input.segments.find((s) => s.id === input.segmentId);
  const target = row ? f.rules.segments[row.sequence] : undefined;
  if (
    !row ||
    !target ||
    target.type !== 'speech' ||
    target.key === finalSpeechKey(f.rules.segments) ||
    clockOf(step).lifecycle.status !== 'active'
  )
    throw createAppError('INVARIANT');
  return { row, target };
}

function requireSettledTime(
  f: StepFacts,
  deadline: number,
  row: HydratedSegment,
): void {
  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(f.now) ||
    deadline < instantMs(row.startedAt) + attendancePolicy.graceMs ||
    f.now < deadline + attendancePolicy.finalizationBufferMs
  )
    throw createAppError('INVARIANT');
}
