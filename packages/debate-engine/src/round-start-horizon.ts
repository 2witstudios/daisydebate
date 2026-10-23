import { createAppError } from '@daisy/errors';
import type { CommandContext } from './round-commands';

/**
 * Whether a Round's start horizon has passed (DEC-214). A Round still
 * scheduled at Launch plus its horizon was never started, so maintenance
 * abandons it: no outcome, forfeit or rating, and its bot capacity and
 * unspent allowance are released. One rule for human and bot Rounds. Any
 * other status was already decided by starting or ending. The horizon is an
 * explicit injected policy, never a hidden default.
 */
export function decideStartHorizon(input: {
  readonly status: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly launchedAtMs: number;
  readonly horizonMs: number;
  readonly nowMs: number;
}): 'keep' | 'abandon' {
  if (!Number.isSafeInteger(input.horizonMs) || input.horizonMs < 1)
    throw createAppError('INVARIANT', 'Start horizon policy must be positive');
  return input.status === 'scheduled' &&
    input.nowMs >= input.launchedAtMs + input.horizonMs
    ? 'abandon'
    : 'keep';
}

/** Like a scheduled forfeit, with no seat: abandoned, no outcome, history kept. */
export function abandonUnstartedRound(c: CommandContext): void {
  if (c.on.lifecycle().status !== 'scheduled')
    throw createAppError(
      'CONFLICT',
      'Only a scheduled Round is abandoned by its start horizon',
    );
  c.on.setLifecycle({ status: 'abandoned', completedAtMs: c.now });
}
