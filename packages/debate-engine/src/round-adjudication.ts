import { instantMs } from '@daisy/clock';
import { createAppError } from '@daisy/errors';
import {
  leadSeatOf,
  otherSide,
  sameSeat,
  sideOfSeat,
  winnerOutcome,
  type HydratedSegment,
  type RoundParticipantSeat,
} from '@daisy/protocol';
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
  type CommandContext,
} from './round-commands';

export type RoundAdjudication = {
  readonly segmentId: string;
  readonly decision: RoundEndingDecision;
  readonly now: string;
};
/** Only the durable evaluator supplies a verified decision; this guards its actual runtime target. */
export function applyRoundAdjudication(
  c: CommandContext,
  input: RoundAdjudication,
  segments: readonly HydratedSegment[],
  participants: readonly RoundParticipantSeat[],
): void {
  const { row, target } = requireActualSpeech(c, input, segments);
  const { decision } = input;
  if (decision.evidence === 'resolution_cutoff') {
    requirePassedCutoff(c, segments);
    closePlayedRound(c);
    c.on.setLifecycle(abandonedLifecycle(c.on.lifecycle(), c.now));
    return;
  }
  requireSettledTime(c, decision.effectiveDeadlineMs, row);
  const speaker = leadSeatOf(target.speak);
  if (speaker === null || !participants.some((p) => sameSeat(p.seat, speaker)))
    throw createAppError('INVARIANT');
  if (decision.decision === 'forfeit') {
    const side = sideOfSeat(speaker);
    if (
      !forfeitsToOpponent(c.rules) ||
      side === null ||
      decision.winner !== otherSide(c.rules.sides, side)
    )
      throw createAppError('INVARIANT');
    closePlayedRound(c);
    return completeWith(c, winnerOutcome(decision.winner));
  }
  closePlayedRound(c);
  c.on.setLifecycle(abandonedLifecycle(c.on.lifecycle(), c.now));
}

/** Only a debate whose last segment closed has a cutoff, and only then can it pass. */
function requirePassedCutoff(
  c: CommandContext,
  segments: readonly HydratedSegment[],
): void {
  const cutoffAtMs = resolutionCutoffOf(c.rules, segments);
  if (cutoffAtMs === null || !Number.isFinite(c.now) || c.now < cutoffAtMs)
    throw createAppError('INVARIANT');
}

function requireActualSpeech(
  c: CommandContext,
  input: RoundAdjudication,
  segments: readonly HydratedSegment[],
) {
  const row = segments.find((s) => s.id === input.segmentId);
  const target = row ? c.rules.segments[row.sequence] : undefined;
  if (
    !row ||
    !target ||
    target.type !== 'speech' ||
    target.key === finalSpeechKey(c.rules.segments) ||
    c.on.lifecycle().status !== 'active'
  )
    throw createAppError('INVARIANT');
  return { row, target };
}
function requireSettledTime(
  c: CommandContext,
  deadline: number,
  row: HydratedSegment,
): void {
  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(c.now) ||
    deadline < instantMs(row.startedAt) + attendancePolicy.graceMs ||
    c.now < deadline + attendancePolicy.finalizationBufferMs
  )
    throw createAppError('INVARIANT');
}
