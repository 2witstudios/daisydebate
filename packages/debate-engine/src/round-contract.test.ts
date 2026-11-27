import { instantMs } from '@daisy/clock';
import { assertRejects } from '@daisy/errors/testing';
import { roundLifecycleFault } from '@daisy/protocol/round-lifecycle';
import { runtimeCheckpointSchema } from '@daisy/protocol/round';
import {
  type HydratedSegment,
  type RoundCommand,
  type RoundParticipantSeat,
  type RoundProjection,
} from '@daisy/protocol/runtime';
import { type RoundRules } from '@daisy/protocol/format';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import type { RoundRuntime } from './round-runtime-api';
import { createRoundRuntime } from './round-runtime';
import { normalizeRoundClock } from './round-clock-state';
import { roundControlsAt } from './round-position';
import {
  emptyCheckpoint,
  hydratedRound,
  lifecycleIn,
  oneOnOneActors,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
} from './runtime.test-support';
import { teamActors, teamRules, teamSeats } from './team-round.test-support';

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
  'cancel_prep',
  'start_speech',
  'yield',
  'offer_poi',
  'withdraw_poi',
  'accept_poi',
  'decline_poi',
  'end_poi',
  'forfeit',
];

/** A Round to walk: its rules, its cast, and the actors who press. */
type WalkedRound = {
  readonly rules: RoundRules;
  readonly seats: readonly RoundParticipantSeat[];
  readonly actors: readonly string[];
  /** The longest time one step moves the clock. */
  readonly stepMs: number;
};
const oneOnOne: WalkedRound = {
  rules,
  seats: oneOnOneSeats,
  actors: [oneOnOneActors.affirmative, oneOnOneActors.negative],
  stepMs: 40_000,
};
/** Steps short enough that an offer is still standing when the speaker answers it. */
const team: WalkedRound = {
  rules: teamRules(),
  seats: teamSeats(),
  actors: [teamActors.aff1, teamActors.aff2, teamActors.neg1, teamActors.neg2],
  stepMs: 12_000,
};

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
  { rules, seats, actors, stepMs }: WalkedRound = oneOnOne,
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
      participants: seats,
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
    participants: seats,
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
  // A press names a segment near where the Round is, as a client would, so
  // most are current and some are stale.
  const standingOffers = (): readonly string[] => {
    const point = runtime.checkpoint().point_of_information;
    return point.phase === 'offered'
      ? point.offers.map((offer) => offer.participant_id)
      : seats.map((seat) => seat.id);
  };
  const command = (now: string) => {
    const position = runtime.position(now);
    const sequence = pick([
      position.openSegment?.sequence ?? 0,
      (position.openSegment?.sequence ?? -1) + 1,
      position.nextSegment?.sequence ?? 0,
    ]);
    const type = pick(offered);
    const pressed: RoundCommand =
      type === 'forfeit'
        ? { type }
        : type === 'accept_poi'
          ? {
              type,
              sequence,
              offererParticipantId: pick(standingOffers()),
            }
          : { type, sequence };
    return runtime.execute({ command: pressed, actorId: pick(actors), now });
  };
  const incident = (now: string) =>
    runtime.applyIncident(
      pick([
        {
          kind: 'pause',
          atMs: instantMs(now),
          cause: 'vendor_unreachable',
          confirmedUntilMs: null,
        },
        { kind: 'begin_resume', atMs: instantMs(now), countdownMs: 5_000 },
        ...(seed % 7 === 0
          ? [{ kind: 'end', atMs: instantMs(now) } as const]
          : []),
      ] as const),
    );
  let latest: NonNullable<RoundProjection['round']> | null = null;
  // A seat presses what the browser's own options call legal; the engine must
  // agree, or the two derivations have drifted apart (ADR 0911).
  const legalPress = (now: string) => {
    if (latest === null) return runtime.tick(now);
    const round = latest;
    const pressable = seats
      .filter((row) => actors.includes(row.actorId))
      .flatMap((seat) =>
        roundControlsAt({
          round,
          segments,
          checkpoint: round.checkpoint,
          rules,
          participants: seats,
          seat,
          nowMs: instantMs(now),
        })
          .options.filter(
            (option) =>
              option.legal &&
              // Endings come from the random presses; these keep a Round going.
              !['forfeit', 'leave', 'yield', 'decline_poi'].includes(
                option.command.type,
              ),
          )
          .map((option) => ({ seat, command: option.command })),
      );
    if (pressable.length === 0) return runtime.tick(now);
    const { seat, command } = pick(pressable);
    try {
      return runtime.execute({ command, actorId: seat.actorId, now });
    } catch (error) {
      faults.push(
        `seed ${seed}: offered ${command.type} as legal, then refused it: ${String(error)}`,
      );
      return runtime.tick(now);
    }
  };
  const steps = [
    tick,
    tick,
    command,
    command,
    command,
    legalPress,
    legalPress,
    legalPress,
    incident,
  ];
  let projection = runtime.activate({ at: roundAt(0), now: roundAt(0) });
  for (let step = 0; step < 240; step += 1) {
    const round = projection.round;
    if (round !== null) {
      const position = runtime.position(roundAt(nowMs));
      seen.add(`${round.status}/${round.currentStage ?? '-'}`);
      seen.add(`incident ${round.checkpoint.incident.phase}`);
      seen.add(`prep ${round.checkpoint.prep.phase}`);
      seen.add(`poi ${round.checkpoint.point_of_information.phase}`);
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
      latest = round;
      try {
        runtime = hydrate(round, segments);
      } catch (error) {
        faults.push(`seed ${seed} step ${step}: ${String(error)}`);
        return faults;
      }
    }
    nowMs += Math.floor(next() * stepMs);
    try {
      projection = pick(steps)(roundAt(nowMs));
    } catch {
      // A refused command or event leaves the Round unchanged.
      projection = runtime.tick(roundAt(nowMs));
    }
  }
  return faults;
};

/** Rounds played to their ballot (1, 6, 8, 13), ended by forfeit (5, 10) and ended by the platform (14). */
const seeds = [1, 5, 6, 8, 10, 13, 14];
/** Team Rounds through called prep, partner prep and points of information offered, taken and given back. */
const teamSeeds = Array.from({ length: 16 }, (_, index) => index + 1);

test('every state the engine projects is one the contracts hold', () => {
  const seen = new Set<string>();
  assert({
    given:
      'seven seeded one-on-one Rounds and sixteen team Rounds of ticks, every command from every debater, presses of what each seat is offered, and platform pauses and resumes, each step hydrated again from what it projected',
    should:
      'project only lifecycles, checkpoints and stages the wire contracts and the hydration check accept, and never refuse a command the browser was offered as legal',
    actual: [
      ...seeds.flatMap((seed) => walk(seed, seen)),
      ...teamSeeds.flatMap((seed) => walk(seed, seen, team)),
    ],
    expected: [],
  });
  assert({
    given: 'those walks',
    should:
      'have passed through every stage, both endings, a platform hold, every prep state and every point-of-information state',
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
      'poi none',
      'poi offered',
      'poi speaking',
      'prep called',
      'prep idle',
      'prep lead',
      'prep running',
    ],
  });
  // Each step builds a runtime again; a slow runner needs more than the default.
}, 60_000);

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

test('a checkpoint whose prep or point disagrees with the segment rows is refused (INTX-1)', async () => {
  const speech = {
    id: 'segment-1',
    sequence: 0,
    type: 'speech' as const,
    rulesSegmentKey: 'AC',
    startedAt: roundAt(10_000),
    endedAt: null,
    durationMs: 300_000,
    returnedMs: 0,
  };
  for (const [given, segments, checkpoint] of [
    [
      'prep running beside a live speech',
      [speech],
      {
        ...emptyCheckpoint,
        prep: { phase: 'running', side: 'affirmative', started_at: roundAt(0) },
      },
    ],
    [
      'prep called with no live segment to wait on',
      [],
      { ...emptyCheckpoint, prep: { phase: 'called', side: 'affirmative' } },
    ],
    [
      'a point of information in a speech that takes none',
      [speech],
      {
        ...emptyCheckpoint,
        point_of_information: {
          phase: 'speaking',
          holder_participant_id: oneOnOneSeats[1].id,
          accepted_at: roundAt(20_000),
        },
      },
    ],
  ] as const)
    await assertRejects({
      given,
      should: 'refuse it as the registered corruption',
      actual: async () =>
        normalizeRoundClock({
          round: lifecycleIn('active'),
          rules,
          segments,
          checkpoint,
        }),
      code: 'INVARIANT',
      invariantId: 'round.live.open-segment-count',
    });
});
