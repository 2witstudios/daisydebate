import {
  type HydratedRound,
  type HydratedSegment,
  type RoundLifecycle,
  type RoundParticipantSeat,
  type RoundRules,
  type RoundStatus,
} from '@daisy/protocol';
import {
  oneOnOneFormatFixture,
  oneOnOneSettingsFixture,
} from '@daisy/protocol/testing';
import { createRoundRuntime } from './round-runtime';
import { normalizeRoundClock } from './round-clock-state';
import { stageOf } from './round-position-projection';
import { resolveRoomConfiguration } from './resolve-room-configuration';

/** The canonical protocol fixture keeps parser and resolver tests aligned. */
export const oneOnOneDefinition = oneOnOneFormatFixture;

/** One-on-one's format settings; a room adopts them as its config. */
export const oneOnOneSettings = oneOnOneSettingsFixture;

/** The resolved rules for the one-on-one casual room; throws when it refuses. */
export const oneOnOneRules = (): RoundRules => {
  const outcome = resolveRoomConfiguration(
    oneOnOneDefinition,
    oneOnOneSettings,
  );
  if (!outcome.ok) throw new Error(outcome.refusal.message);
  return outcome.rules;
};

/** Sequential segment ids, so projections are deterministic in tests. */
const sequentialSegmentIds = (): (() => string) => {
  let next = 0;
  return () => {
    next += 1;
    return `segment-${next}`;
  };
};

/** The instant the runtime tests' clock starts from. */
const t0 = '2026-10-06T09:00:00.000Z';

/** An ISO instant `ms` after the tests' clock start. */
export const roundAt = (ms: number): string =>
  new Date(Date.parse(t0) + ms).toISOString();

const affirmativeActor = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const negativeActor = 'a7b3c9d1e5f2k4m6n8p1r3t5';
const judgeActor = 'c8d4e2f6a1b3k5m7n9p2r4t6';

/** The one-on-one round's three seated actors: both sides and the judge. */
export const oneOnOneActors = {
  affirmative: affirmativeActor,
  negative: negativeActor,
  judge: judgeActor,
} as const;

/** The seats those actors hold, in slot order. */
export const oneOnOneSeats = [
  {
    id: 'm3w8k1z5c9b2n7p4r6t0v2x4',
    actorId: affirmativeActor,
    role: 'affirmative',
    slot: 0,
  },
  {
    id: 'q5x2v8t0r4p6n2b8c1z7k3m9',
    actorId: negativeActor,
    role: 'negative',
    slot: 0,
  },
  {
    id: 'd6y3h9j1f5a7s3g8l2q6e4u0i',
    actorId: judgeActor,
    role: 'judge',
    slot: 0,
  },
] as const;

/** The empty checkpoint a fresh round hydrates from. */
export const emptyCheckpoint = {
  version: 1,
  prep_consumed_ms: { affirmative: 0, negative: 0 },
  active_prep: null,
  floor: null,
  incident: { phase: 'none' },
  prep_ended_at: null,
  start_gate: null,
  clock_stops: [],
} as const;

/** Options `runtimeWorld` takes; every field defaults to a fresh round. */
export type RuntimeWorldOptions = {
  readonly status?: RoundStatus;
  readonly segments?: Parameters<typeof createRoundRuntime>[0]['segments'];
  readonly checkpoint?: unknown;
  readonly rules?: RoundRules;
  readonly participants?: readonly RoundParticipantSeat[];
};

/** The lifecycle a Round in `status` holds, started and ended at the round's first instant. */
export const lifecycleIn = (status: RoundStatus): RoundLifecycle => {
  const none = { completedAt: null, outcome: null } as const;
  switch (status) {
    case 'opening':
      return { status, startedAt: null, ...none };
    case 'active':
      return { status, startedAt: roundAt(0), ...none };
    case 'completed':
    case 'abandoned':
      return {
        status,
        startedAt: roundAt(0),
        completedAt: roundAt(0),
        outcome: null,
      };
  }
};

/** The Round row a clock hydrates from: its lifecycle with the stage its clock derives. */
export const hydratedRound = (
  lifecycle: RoundLifecycle,
  clock: {
    readonly rules: RoundRules;
    readonly checkpoint: unknown;
    readonly segments: readonly HydratedSegment[];
  },
): HydratedRound => ({
  id: 'round-1',
  ...lifecycle,
  currentStage: stageOf(
    normalizeRoundClock({ round: lifecycle, ...clock }),
    clock.rules.segments.length,
  ),
});

/** A runtime over the one-on-one format, as the runtime tests execute it. */
export const runtimeWorld = ({
  status = 'opening',
  segments = [],
  checkpoint = emptyCheckpoint,
  rules = oneOnOneRules(),
  participants = oneOnOneSeats,
}: RuntimeWorldOptions = {}) =>
  createRoundRuntime({
    round: hydratedRound(lifecycleIn(status), { rules, checkpoint, segments }),
    rules,
    participants: [...participants],
    checkpoint,
    segments,
    nextSegmentId: sequentialSegmentIds(),
  });

/** The one-on-one round's full span: one countdown per segment plus speech time. */
const oneOnOneRoundTotalMs = (rules: RoundRules): number =>
  rules.segments.length * rules.countdownMs +
  rules.segments.reduce((sum, segment) => sum + segment.durationMs, 0);

/** The one-on-one world's rules, actors and clock, as the runtime tests bind them. */
export const oneOnOneCast = () => ({
  rules: oneOnOneRules(),
  at: roundAt,
  person: oneOnOneActors.affirmative,
  opponent: oneOnOneActors.negative,
  judge: oneOnOneActors.judge,
});

/** A started one-on-one world, ticked to the instant its final segment is due. */
export const completedSchedule = (rules: RoundRules) => {
  const world = runtimeWorld();
  world.activate({ at: roundAt(0), now: roundAt(0) });
  const totalMs = oneOnOneRoundTotalMs(rules);
  world.tick(roundAt(totalMs));
  return { world, totalMs };
};
