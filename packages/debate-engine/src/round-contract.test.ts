import { assertRejects } from '@daisy/errors/testing';
import {
  roundLifecycleFault,
  runtimeCheckpointSchema,
  type HydratedSegment,
  type RoundCommand,
  type RoundProjection,
} from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundRuntime } from './round-runtime-api';
import { createRoundRuntime } from './round-runtime';
import {
  emptyCheckpoint,
  hydratedRound,
  lifecycleIn,
  oneOnOneActors,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
} from './runtime.test-support';

setupRitewayBun();

const rules = oneOnOneRules();

/** A small seeded generator, so every walk is the same on every run. */
const seeded = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const commands: readonly RoundCommand['type'][] = [
  'start_prep',
  'start_speech',
  'yield',
  'interrupt',
  'forfeit',
];
const actors = [oneOnOneActors.affirmative, oneOnOneActors.negative];

/** The segment rows after a projection's writes, as the adapter stores them. */
const rowsAfter = (
  rows: readonly HydratedSegment[],
  projection: RoundProjection,
): readonly HydratedSegment[] =>
  [
    ...rows,
    ...projection.segmentInserts.map((row) => ({
      ...row,
      endedAt: null,
      returnedMs: 0,
    })),
  ].map((row) => ({
    ...row,
    endedAt:
      projection.segmentCloses.find((close) => close.id === row.id)?.endedAt ??
      row.endedAt,
    returnedMs:
      projection.segmentReturns?.find((back) => back.id === row.id)
        ?.returnedMs ?? row.returnedMs,
  }));

/**
 * One seeded walk through a Round: time moves, players try every command, the
 * platform pauses and resumes. After each step the Round is hydrated again from
 * exactly what the step projected, as the adapter would, and every fault found
 * is returned.
 */
const walk = (
  seed: number,
  seen: Set<string> = new Set(),
): readonly string[] => {
  const next = seeded(seed);
  const pick = <T>(from: readonly T[]): T =>
    from[Math.floor(next() * from.length)]!;
  let ids = 0;
  const hydrate = (
    round: NonNullable<RoundProjection['round']>,
    segments: readonly HydratedSegment[],
  ): RoundRuntime =>
    createRoundRuntime({
      round: { ...round, id: 'round-1' },
      rules,
      participants: oneOnOneSeats,
      checkpoint: round.checkpoint,
      segments,
      nextSegmentId: () => `segment-${++ids}`,
    });
  let segments: readonly HydratedSegment[] = [];
  let runtime = createRoundRuntime({
    round: hydratedRound(lifecycleIn('opening'), {
      rules,
      checkpoint: emptyCheckpoint,
      segments,
    }),
    rules,
    participants: oneOnOneSeats,
    checkpoint: emptyCheckpoint,
    segments,
    nextSegmentId: () => `segment-${++ids}`,
  });
  const faults: string[] = [];
  let nowMs = 0;
  // Most Rounds are played through; some end by forfeit or by the platform.
  const offered = commands.filter(
    (type) => type !== 'forfeit' || seed % 5 === 0,
  );
  const tick = (now: string) => runtime.tick(now);
  const command = (now: string) =>
    runtime.execute({
      command: { type: pick(offered) },
      actorId: pick(actors),
      now,
    });
  const incident = (now: string) =>
    runtime.applyIncident(
      pick([
        {
          kind: 'pause',
          atMs: Date.parse(now),
          cause: 'vendor_unreachable',
          confirmedUntilMs: null,
        },
        { kind: 'begin_resume', atMs: Date.parse(now), countdownMs: 5_000 },
        ...(seed % 7 === 0
          ? [{ kind: 'end', atMs: Date.parse(now) } as const]
          : []),
      ] as const),
    );
  const steps = [tick, tick, command, command, command, command, incident];
  let projection = runtime.activate({ at: roundAt(0), now: roundAt(0) });
  for (let step = 0; step < 240; step += 1) {
    const round = projection.round;
    if (round !== null) {
      const position = runtime.position(roundAt(nowMs));
      seen.add(`${round.status}/${round.currentStage ?? '-'}`);
      seen.add(`incident ${round.checkpoint.incident.phase}`);
      const checkpoint = runtimeCheckpointSchema.safeParse(round.checkpoint);
      const found = [
        roundLifecycleFault(round),
        roundLifecycleFault(position),
        checkpoint.success ? null : 'The projected checkpoint does not parse',
        position.stage === round.currentStage || position.status !== 'active'
          ? null
          : 'The projected stage is not the position stage',
      ].filter((fault) => fault !== null);
      faults.push(
        ...found.map((fault) => `seed ${seed} step ${step}: ${fault}`),
      );
      segments = rowsAfter(segments, projection);
      try {
        runtime = hydrate(round, segments);
      } catch (error) {
        faults.push(`seed ${seed} step ${step}: ${String(error)}`);
        return faults;
      }
    }
    nowMs += Math.floor(next() * 40_000);
    try {
      projection = pick(steps)(roundAt(nowMs));
    } catch {
      // A refused command or event leaves the Round unchanged.
      projection = runtime.tick(roundAt(nowMs));
    }
  }
  return faults;
};

test('every state the engine projects is one the contracts hold', () => {
  const seen = new Set<string>();
  assert({
    given:
      'twenty seeded Rounds of ticks, every command from both debaters, and platform pauses and resumes, each step hydrated again from what it projected',
    should:
      'project only lifecycles, checkpoints and stages the wire contracts and the hydration check accept',
    actual: Array.from({ length: 20 }, (_, seed) =>
      walk(seed + 1, seen),
    ).flat(),
    expected: [],
  });
  assert({
    given: 'those walks',
    should: 'have passed through every stage, both endings and a platform hold',
    actual: [...seen].sort(),
    expected: [
      'abandoned/-',
      'active/awaiting_ballot',
      'active/countdown',
      'active/live',
      'active/prep',
      'completed/-',
      'incident none',
      'incident paused',
      'incident resuming',
    ],
  });
});

test('a stored stage the clock does not derive is corruption', async () => {
  const active = hydratedRound(lifecycleIn('active'), {
    rules,
    checkpoint: emptyCheckpoint,
    segments: [],
  });
  const hydrate = (currentStage: typeof active.currentStage) =>
    createRoundRuntime({
      round: { ...active, currentStage },
      rules,
      participants: oneOnOneSeats,
      checkpoint: emptyCheckpoint,
      segments: [],
      nextSegmentId: () => 'unused',
    });
  assert({
    given: 'an active Round before its first speech, stored in its countdown',
    should: 'hydrate, at the stage its clock derives',
    actual: [
      active.currentStage,
      hydrate('countdown').position(roundAt(0)).stage,
    ],
    expected: ['countdown', 'countdown'],
  });
  for (const stage of ['live', 'prep', 'awaiting_ballot', null] as const)
    await assertRejects({
      given: `the same Round stored as ${stage ?? 'no stage'}`,
      should: 'refuse the stage the clock does not derive',
      actual: async () => hydrate(stage),
      code: 'INVARIANT',
      invariantId: 'round.stage.matches-clock',
    });
});
