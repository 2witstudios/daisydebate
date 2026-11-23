import { instantMs, tryInstantMs } from '@daisy/clock';
import { createInvariantError } from '@daisy/errors';
import {
  runtimeCheckpointSchema,
  type RuntimeCheckpoint,
} from '@daisy/protocol/round';
import {
  type HydratedRound,
  type HydratedSegment,
  type RoundParticipantSeat,
  type RoundPosition,
  type RoundProjection,
} from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import type { RoundRuntime } from './round-runtime-api';
import { assertAttendanceRules } from './attendance-policy';
import { advanceRoundClock } from './round-clock';
import { debateHasEnded, normalizeRoundClock } from './round-clock-state';
import { positionAtState, stageOf } from './round-position-projection';
import { debateInvariantIds } from './invariant-ids';
import { stepRound, type RoundEvent } from './round-engine';
import type { RoundState } from './round-step';
import {
  projectRoundStep,
  storedCheckpointOf,
  validClockOf,
} from './round-step-projection';

/**
 * The one round runtime (ADR 0058): execution over durable state. Postgres
 * is truth — the open `round_segments` row is the live interval — and the
 * Round's next state is `stepRound` of its rules, its rows and an injected
 * instant. This runtime hydrates that state once, steps it for each call and
 * projects the step into the durable writes that materialize it, minting
 * ids only there. The AI is an actor implementation here: a bot seat
 * receives the same commands a human's seat would, submitted by
 * orchestration. A refused call leaves the runtime's state unchanged.
 */

/** The clock a Round's rows hydrate to. The stored stage is its projection; one that disagrees is corruption. */
const hydratedClock = (
  input: Parameters<typeof normalizeRoundClock>[0] & {
    readonly round: Pick<HydratedRound, 'currentStage'>;
  },
) => {
  const clock = normalizeRoundClock(input);
  if (input.round.currentStage !== stageOf(clock, input.rules.segments.length))
    throw createInvariantError(
      debateInvariantIds.stageMatchesClock,
      'The stored stage is not the one the Round clock derives',
    );
  return { ...clock, checkpoint: storedCheckpointOf(clock.checkpoint) };
};

/**
 * Creates the runtime from durable rows, the frozen rules and an injected
 * id source for projected segment rows. Hydration refuses durable state
 * that disagrees with `rules`: a segment row whose key or duration does not
 * match the rules it claims to execute is corruption, not position.
 */
export function createRoundRuntime(input: {
  readonly round: HydratedRound;
  readonly rules: RoundRules;
  readonly participants: readonly RoundParticipantSeat[];
  readonly checkpoint: unknown;
  readonly segments: readonly HydratedSegment[];
  /** Minted for each projected segment insert; injected, never ambient. */
  readonly nextSegmentId: () => string;
}): RoundRuntime {
  const rules = input.rules;
  assertAttendanceRules(rules);
  let state: RoundState = {
    clock: hydratedClock(input),
    cast: input.participants,
  };
  let segmentIds: ReadonlyMap<number, string> = new Map(
    input.segments.map((row) => [row.sequence, row.id]),
  );

  /** One event: stepped, projected, and kept only once both succeed. */
  const commit = (event: RoundEvent): RoundProjection => {
    const step = stepRound(state, rules, event);
    const projected = projectRoundStep({
      step,
      rules,
      segmentIds,
      mint: input.nextSegmentId,
    });
    state = step.state;
    segmentIds = projected.segmentIds;
    return projected.projection;
  };

  return {
    position(now: string): RoundPosition {
      return positionAtState(validClockOf(state.clock), rules, instantMs(now));
    },
    debateOverAt(now): boolean {
      const advanced = advanceRoundClock(
        validClockOf(state.clock),
        rules,
        instantMs(now),
      );
      return debateHasEnded(advanced.state, rules.segments.length);
    },
    execute: ({ command, actorId, now }) =>
      commit({ kind: 'command', command, actorId, atMs: instantMs(now) }),
    adjudicate: ({ segmentId, decision, now }) =>
      commit({
        kind: 'adjudicate',
        adjudication: { segmentId, decision, segments: input.segments },
        atMs: instantMs(now),
      }),
    stop: (now) => commit({ kind: 'stop', atMs: instantMs(now) }),
    completePanel: (completion) => {
      const at = tryInstantMs(completion.now);
      if (at === undefined)
        throw createInvariantError(
          debateInvariantIds.panelPlayedRound,
          'Panel completion requires a valid clock',
        );
      return commit({ kind: 'complete_panel', completion, atMs: at });
    },
    /**
     * The opening has run: the Round becomes active at the instant it ended,
     * and the clock catches up to `now`, so a late sweep cannot move the
     * countdown.
     */
    activate: ({ at, now }) =>
      commit({
        kind: 'activate',
        startedAtMs: instantMs(at),
        atMs: instantMs(now),
      }),
    applyStartGate: (gate) => commit({ kind: 'start_gate', gate }),
    /** A server-detected platform incident; the clock catches up to its instant first. */
    applyIncident: (incident) => commit({ kind: 'incident', incident }),
    tick: (now) => commit({ kind: 'tick', atMs: instantMs(now) }),
    checkpoint(): RuntimeCheckpoint {
      return runtimeCheckpointSchema.parse(
        storedCheckpointOf(state.clock.checkpoint),
      );
    },
  };
}
