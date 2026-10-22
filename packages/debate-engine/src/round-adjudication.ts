import { createAppError } from '@daisy/errors';
import type {
  DebateSide,
  HydratedSegment,
  RoundParticipantSeat,
} from '@daisy/protocol';
import { attendancePolicy } from './attendance';
import {
  applyRoundCommand,
  closePlayedRound,
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
    | { readonly decision: 'abandoned'; readonly effectiveDeadlineMs: number };
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
  requireSettledTime(c, input, row);
  const speaker = participants.find(
    (p) => p.role === target.side && p.slot === target.slot,
  );
  if (!speaker) throw createAppError('INVARIANT');
  if (input.decision.decision === 'forfeit') {
    const winner = target.side === 'affirmative' ? 'negative' : 'affirmative';
    if (input.decision.winner !== winner) throw createAppError('INVARIANT');
    return applyRoundCommand(
      { ...c, actorId: speaker.actorId },
      { type: 'forfeit' },
    );
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
  input: RoundAdjudication,
  row: HydratedSegment,
): void {
  const deadline = input.decision.effectiveDeadlineMs;
  if (
    !Number.isFinite(deadline) ||
    !Number.isFinite(c.now) ||
    deadline < Date.parse(row.startedAt) + attendancePolicy.graceMs ||
    c.now < deadline + attendancePolicy.finalizationBufferMs
  )
    throw createAppError('INVARIANT');
}
