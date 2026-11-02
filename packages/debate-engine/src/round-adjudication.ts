import { createAppError } from '@daisy/errors';
import type {
  DebateSide,
  HydratedSegment,
  RoundParticipantSeat,
} from '@daisy/protocol';
import { attendancePolicy } from './attendance';
import {
  closePlayedRound,
  completeWith,
  type CommandContext,
} from './round-commands';

export type RoundAdjudication = {
  readonly segmentId: string;
  readonly decision:
    | {
        readonly decision: 'forfeit';
        readonly winner: DebateSide;
        readonly effectiveDeadlineMs: number;
      }
    | { readonly decision: 'abandoned'; readonly effectiveDeadlineMs: number }
    /** Settled evidence never came and the persisted cutoff passed (DEC-276). */
    | { readonly decision: 'unresolved'; readonly cutoffAtMs: number };
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
  if (input.decision.decision === 'unresolved') {
    if (
      !Number.isFinite(input.decision.cutoffAtMs) ||
      !Number.isFinite(c.now) ||
      c.now < input.decision.cutoffAtMs
    )
      throw createAppError('INVARIANT');
    closePlayedRound(c);
    c.on.setLifecycle({ status: 'abandoned', completedAtMs: c.now });
    return;
  }
  requireSettledTime(c, input.decision.effectiveDeadlineMs, row);
  if (
    !participants.some((p) => p.role === target.side && p.slot === target.slot)
  )
    throw createAppError('INVARIANT');
  if (input.decision.decision === 'forfeit') {
    const winner = target.side === 'affirmative' ? 'negative' : 'affirmative';
    if (input.decision.winner !== winner) throw createAppError('INVARIANT');
    closePlayedRound(c);
    return completeWith(c, winner);
  }
  closePlayedRound(c);
  c.on.setLifecycle({ status: 'abandoned', completedAtMs: c.now });
}

function requireActualSpeech(
  c: CommandContext,
  input: RoundAdjudication,
  segments: readonly HydratedSegment[],
) {
  const row = segments.find((s) => s.id === input.segmentId);
  const target = row ? c.rules.segments[row.sequence] : undefined;
  const lastSpeech = c.rules.segments.reduce(
    (last, s, index) => (s.type === 'speech' ? index : last),
    -1,
  );
  if (
    !row ||
    !target ||
    target.type !== 'speech' ||
    row.sequence === lastSpeech ||
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
    deadline < Date.parse(row.startedAt) + attendancePolicy.graceMs ||
    c.now < deadline + attendancePolicy.finalizationBufferMs
  )
    throw createAppError('INVARIANT');
}
