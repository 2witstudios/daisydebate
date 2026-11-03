import type {
  HydratedRound,
  HydratedSegment,
  RoundRules,
  RoundParticipantSeat,
  RoundPosition,
} from '@daisy/protocol';
import { advanceRoundClock } from './round-clock';
import { normalizeRoundClock } from './round-clock-state';
import {
  roundCommandOptions,
  type RoundCommandOption,
} from './round-command-legality';
import { positionAtState, roundPositionOf } from './round-position-projection';
export type { RoundPosition, RoundCommandOption };

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

/**
 * What one seat reads at one instant: the position and the commands it is
 * offered, both from one advance of the clock, by the rule the engine enforces.
 */
export const roundControlsAt = (input: {
  readonly round: Pick<
    HydratedRound,
    'status' | 'startedAt' | 'completedAt' | 'outcome'
  >;
  readonly segments: readonly HydratedSegment[];
  readonly checkpoint: unknown;
  readonly rules: RoundRules;
  readonly participants: readonly RoundParticipantSeat[];
  readonly seat: RoundParticipantSeat;
  readonly nowMs: number;
}): {
  readonly position: RoundPosition;
  readonly options: readonly RoundCommandOption[];
} => {
  const { state } = advanceRoundClock(
    normalizeRoundClock(input),
    input.rules,
    input.nowMs,
  );
  return {
    position: roundPositionOf(state, input.nowMs, input.rules),
    options: roundCommandOptions({
      rules: input.rules,
      state,
      participants: input.participants,
      seat: input.seat,
      nowMs: input.nowMs,
    }),
  };
};
