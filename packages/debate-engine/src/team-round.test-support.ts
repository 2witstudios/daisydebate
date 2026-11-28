import { roundRulesSchema, type RoundRules } from '@daisy/protocol/format';
import type { RoundParticipantSeat } from '@daisy/protocol/runtime';
import { twoSides } from '@daisy/protocol/seats';
import { createRoundRuntime } from './round-runtime';
import {
  emptyCheckpoint,
  hydratedRound,
  lifecycleIn,
} from './runtime.test-support';

/**
 * A two-on-two Round with prep and points of information, for the rules a
 * one-on-one Round cannot show: a partner's prep, the other side's offers, a
 * teammate who may not offer, and cross-examination led by one of two seats.
 *
 * Timeline at a 10 s countdown: 1A 10s–430s, 1N 440s–860s, CX 870s–1050s
 * (2A asks), 2A 1060s–1480s, 2N 1490s–1910s.
 */
export const teamRules = (
  patch: {
    readonly countdownMs?: number;
    readonly yieldAllowed?: boolean;
    readonly returnsTime?: boolean;
    readonly pointsOfInformation?: RoundRules['interaction']['pointsOfInformation'];
    /** A ranking Round is left, not forfeited (TAB-6.8). */
    readonly outcome?: RoundRules['outcome'];
  } = {},
): RoundRules =>
  roundRulesSchema.parse({
    version: 3,
    sides: twoSides,
    seats: {
      sides: { affirmative: 2, negative: 2 },
      speakers: 0,
      judges: 1,
      moderators: 0,
    },
    outcome: patch.outcome ?? { kind: 'winner' },
    segments: [
      speech('1A', 'First affirmative', 'affirmative', 0),
      speech('1N', 'First negative', 'negative', 0),
      {
        key: 'CX',
        label: 'Cross-examination',
        type: 'cross_ex',
        speak: {
          rights: 'all',
          lead: { kind: 'side', side: 'affirmative', slot: 1 },
        },
        durationMs: 180_000,
      },
      speech('2A', 'Second affirmative', 'affirmative', 1),
      speech('2N', 'Second negative', 'negative', 1),
    ],
    inRoundPrep: {
      budgetMsPerSide: 120_000,
      spendableBefore: ['speech', 'cross_ex'],
      expiresAtSegment: null,
    },
    countdownMs: patch.countdownMs ?? 10_000,
    interaction: {
      yield: {
        allowed: patch.yieldAllowed ?? true,
        returnsTime: patch.returnsTime ?? true,
      },
      pointsOfInformation: patch.pointsOfInformation ?? {
        allowed: true,
        protectedStartMs: 60_000,
        protectedEndMs: 60_000,
        maxDurationMs: 15_000,
        offerLapseMs: 10_000,
      },
    },
  });

function speech(
  key: string,
  label: string,
  side: 'affirmative' | 'negative',
  slot: number,
) {
  return {
    key,
    label,
    type: 'speech',
    speak: { rights: 'one', seat: { kind: 'side', side, slot } },
    durationMs: 420_000,
  };
}

/** The four debaters and the judge: actor ids double as readable names. */
export const teamActors = {
  aff1: 'aff1actor0f4m8q3w1z7c5n6',
  aff2: 'aff2actor0f4m8q3w1z7c5n6',
  neg1: 'neg1actor0f4m8q3w1z7c5n6',
  neg2: 'neg2actor0f4m8q3w1z7c5n6',
  judge: 'judgeactor0f4m8q3w1z7c5n',
} as const;

/** Each seat's participant id, by the actor's name. */
export const teamSeatIds = {
  aff1: 'aff1seat2v8t0r4p6n2b8c1z',
  aff2: 'aff2seat2v8t0r4p6n2b8c1z',
  neg1: 'neg1seat2v8t0r4p6n2b8c1z',
  neg2: 'neg2seat2v8t0r4p6n2b8c1z',
  judge: 'judgeseat2v8t0r4p6n2b8c1',
} as const;

/** The cast, with any seat a bot's. */
export const teamSeats = (
  bots: readonly (keyof typeof teamActors)[] = [],
): readonly RoundParticipantSeat[] => {
  const seat = (
    name: keyof typeof teamActors,
    ref: RoundParticipantSeat['seat'],
  ): RoundParticipantSeat => ({
    id: teamSeatIds[name],
    actorId: teamActors[name],
    seat: ref,
    kind: bots.includes(name) ? 'bot' : 'human',
  });
  return [
    seat('aff1', { kind: 'side', side: 'affirmative', slot: 0 }),
    seat('aff2', { kind: 'side', side: 'affirmative', slot: 1 }),
    seat('neg1', { kind: 'side', side: 'negative', slot: 0 }),
    seat('neg2', { kind: 'side', side: 'negative', slot: 1 }),
    seat('judge', { kind: 'judge', slot: 0 }),
  ];
};

/** A started team Round's runtime; its segments run on the clock from `at(0)`. */
export const teamWorld = ({
  rules = teamRules(),
  bots = [],
}: {
  readonly rules?: RoundRules;
  readonly bots?: readonly (keyof typeof teamActors)[];
} = {}) => {
  const checkpoint = emptyCheckpoint;
  const world = createRoundRuntime({
    round: hydratedRound(lifecycleIn('opening'), {
      rules,
      checkpoint,
      segments: [],
    }),
    rules,
    participants: teamSeats(bots),
    checkpoint,
    segments: [],
    nextSegmentId: (() => {
      let next = 0;
      return () => `segment-${(next += 1)}`;
    })(),
  });
  return world;
};
