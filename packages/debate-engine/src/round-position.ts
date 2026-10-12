import type {
  HydratedRound,
  HydratedSegment,
  RoundRules,
  RoundPosition,
} from '@daisy/protocol';
import { normalizeRoundClock } from './round-clock-state';
import { positionAtState } from './round-position-projection';
export type { RoundPosition };

/** One authorized durable snapshot and explicit time; safe in the browser CSP. */
export const roundPositionAt = (input: {
  readonly round: Pick<
    HydratedRound,
    'status' | 'startedAt' | 'completedAt' | 'outcome'
  >;
  readonly segments: readonly HydratedSegment[];
  readonly checkpoint: unknown;
  readonly rules: RoundRules;
  readonly nowMs: number;
}): RoundPosition =>
  positionAtState(normalizeRoundClock(input), input.rules, input.nowMs);
