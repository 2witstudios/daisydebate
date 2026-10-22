import { createInvariantError } from '@daisy/errors';
import type { RoundUnjudgedCompletion } from '@daisy/protocol';
import { debateInvariantIds } from './invariant-ids';
import type { CommandContext } from './round-commands';

const isClosedZeroJudgeRound = (c: CommandContext, actualJudgeCount: number) =>
  c.rules.seats.judge === 0 &&
  actualJudgeCount === 0 &&
  c.on.lifecycle().status === 'active' &&
  c.on.openRow() === undefined &&
  c.closedCount() === c.rules.segments.length;

/** The caller verifies immutable freeze and settled attendance under the Round lock. */
export function applyUnjudgedCompletion(
  c: CommandContext,
  input: RoundUnjudgedCompletion,
  actualJudgeCount: number,
): void {
  if (
    input.competitionType !== 'casual' ||
    !isClosedZeroJudgeRound(c, actualJudgeCount) ||
    !Number.isFinite(c.now)
  )
    throw createInvariantError(
      debateInvariantIds.unjudgedCasualOnly,
      'Unjudged completion requires an actually closed casual zero-judge Round',
    );
  c.assertSeatCompleteness();
  const finalEnd = c.on.rows().at(-1)?.endedAtMs;
  if (finalEnd === undefined || finalEnd === null || c.now < finalEnd)
    throw createInvariantError(
      debateInvariantIds.unjudgedCasualOnly,
      'Unjudged completion follows the actual final end',
    );
  c.on.endPrep();
  c.on.setLifecycle({
    status: 'completed',
    outcome: null,
    completedAtMs: c.now,
  });
  c.into.effects.push({
    kind: 'round_completed',
    outcome: null,
    at: input.now,
  });
}
