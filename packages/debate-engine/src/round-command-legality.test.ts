import { instantMs } from '@daisy/clock';
import { assertRejects } from '@daisy/errors/testing';
import {
  emptyRuntimeCheckpointFor,
  type RuntimeCheckpoint,
} from '@daisy/protocol/round';
import { sideSeat } from '@daisy/protocol/seats';
import {
  winnerOutcome,
  type RoundOutcome,
} from '@daisy/protocol/round-outcome';
import { type RoundRules } from '@daisy/protocol/format';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { normalizeRoundClock } from './round-clock-state';
import {
  roundCommandOptions,
  roundCommandRefusal,
  type RoundCommandFacts,
} from './round-command-legality';
import {
  oneOnOneCast,
  oneOnOneRules,
  oneOnOneSeats,
  runtimeWorld,
} from './runtime.test-support';
import {
  teamActors,
  teamRules,
  teamSeatIds,
  teamSeats,
} from './team-round.test-support';

setupRitewayBun();

const { at, opponent } = oneOnOneCast();
const [speaker, respondent, judge] = oneOnOneSeats;
const emptyRuntimeCheckpoint = emptyRuntimeCheckpointFor(oneOnOneRules());

const speechFacts = (
  rules: RoundRules,
  overrides: Partial<RoundCommandFacts> = {},
): RoundCommandFacts => ({
  rules,
  participants: oneOnOneSeats,
  seat: respondent,
  nowMs: instantMs(at(1_000)),
  state: normalizeRoundClock({
    round: {
      status: 'active',
      startedAt: at(0),
      completedAt: null,
      outcome: null,
    },
    rules,
    checkpoint: emptyRuntimeCheckpoint,
    segments: [
      {
        id: 'segment-0',
        sequence: 0,
        type: rules.segments[0]!.type,
        rulesSegmentKey: rules.segments[0]!.key,
        startedAt: at(0),
        endedAt: null,
        durationMs: rules.segments[0]!.durationMs,
        returnedMs: 0,
      },
    ],
  }),
  ...overrides,
});

/** The team Round's first speech, read by `name` at `ms` into it, with `checkpoint`. */
const teamFacts = (
  name: keyof typeof teamActors,
  ms: number,
  checkpoint: RuntimeCheckpoint = emptyRuntimeCheckpointFor(teamRules()),
): RoundCommandFacts => {
  const rules = teamRules();
  const participants = teamSeats();
  return {
    ...speechFacts(rules, {
      participants,
      seat: participants.find((seat) => seat.actorId === teamActors[name])!,
      nowMs: instantMs(at(ms)),
    }),
    state: normalizeRoundClock({
      round: {
        status: 'active',
        startedAt: at(0),
        completedAt: null,
        outcome: null,
      },
      rules,
      checkpoint,
      segments: [
        {
          id: 'segment-0',
          sequence: 0,
          type: 'speech',
          rulesSegmentKey: '1A',
          startedAt: at(0),
          endedAt: null,
          durationMs: 420_000,
          returnedMs: 0,
        },
      ],
    }),
  };
};

const pressed = (facts: RoundCommandFacts) =>
  roundCommandOptions(facts).map((option) => [
    option.command.type,
    option.legal,
  ]);

test('a speech without points of information offers no POI command', async () => {
  const world = runtimeWorld();
  world.activate({ at: at(0), now: at(0) });
  world.tick(at(20_000));
  const before = world.checkpoint();
  await assertRejects({
    given: 'an opponent offering under rules that take no POIs',
    should: 'refuse with the POI-rule invariant',
    actual: () =>
      world.execute({
        command: { type: 'offer_poi', sequence: 0 },
        actorId: opponent,
        now: at(21_000),
      }),
    code: 'INVARIANT',
    invariantId: 'round.poi.requires-rule',
  });
  assert({
    given: 'the refused offer',
    should: 'leave the Round unchanged',
    actual: world.checkpoint(),
    expected: before,
  });
  assert({
    given: 'the respondent reading its options',
    should: 'offer only forfeit',
    actual: pressed(speechFacts(oneOnOneRules())),
    expected: [['forfeit', true]],
  });
});

test('every seat gets its options from one derivation (ISSUE-1013, INTX-13)', () => {
  assert({
    given: 'an opponent in unprotected time',
    should: 'offer calling prep for its own next speech and a legal POI',
    actual: pressed(teamFacts('neg1', 100_000)),
    expected: [
      ['start_prep', true],
      ['offer_poi', true],
      ['forfeit', true],
    ],
  });
  assert({
    given: 'the same opponent inside the protected start',
    should: 'keep the POI offered and mark it illegal',
    actual: pressed(teamFacts('neg1', 30_000))[1],
    expected: ['offer_poi', false],
  });
  assert({
    given: 'the speaker’s partner',
    should: 'offer no POI',
    actual: pressed(teamFacts('aff2', 100_000)),
    expected: [['forfeit', true]],
  });
  assert({
    given: 'a judge',
    should: 'offer nothing',
    actual: pressed(teamFacts('judge', 100_000)),
    expected: [],
  });
  assert({
    given: 'the speaker with no offer standing',
    should: 'offer their own yield',
    actual: pressed(teamFacts('aff1', 100_000)),
    expected: [
      ['yield', true],
      ['forfeit', true],
    ],
  });
  const offered: RuntimeCheckpoint = {
    ...emptyRuntimeCheckpointFor(teamRules()),
    point_of_information: {
      phase: 'offered',
      offers: [{ participant_id: teamSeatIds.neg1, offered_at: at(99_000) }],
    },
  };
  assert({
    given: 'one offer standing, read by the speaker and by the offerer',
    should: 'offer accept and decline to one, withdraw to the other',
    actual: [
      roundCommandOptions(teamFacts('aff1', 100_000, offered)).map(
        (option) => option.command,
      ),
      pressed(teamFacts('neg1', 100_000, offered))[1],
    ],
    expected: [
      [
        { type: 'yield', sequence: 0 },
        {
          type: 'accept_poi',
          sequence: 0,
          offererParticipantId: teamSeatIds.neg1,
        },
        { type: 'decline_poi', sequence: 0 },
        { type: 'forfeit' },
      ],
      ['withdraw_poi', true],
    ],
  });
});

test('either partner of the side that speaks next takes its prep (INTX-2, amends ISSUE-1013)', () => {
  const rules = oneOnOneRules();
  const seats = [
    speaker,
    {
      ...speaker,
      id: 'teammate-seat',
      actorId: 'teammate',
      seat: sideSeat('affirmative', 1),
    },
    respondent,
    judge,
  ];
  const facts = (seat: (typeof seats)[number]): RoundCommandFacts =>
    speechFacts(
      {
        ...rules,
        seats: {
          ...rules.seats,
          sides: { ...rules.seats.sides, affirmative: 2 },
        },
      },
      {
        participants: seats,
        seat,
        state: normalizeRoundClock({
          round: {
            status: 'active',
            startedAt: at(0),
            completedAt: null,
            outcome: null,
          },
          rules,
          checkpoint: emptyRuntimeCheckpoint,
          segments: [],
        }),
      },
    );
  assert({
    given: 'the scheduled speaker, their teammate and the opponent before the speech',
    should: 'allow prep for either affirmative and refuse the negative',
    actual: [
      roundCommandRefusal(facts(speaker), { type: 'start_prep', sequence: 0 }),
      roundCommandRefusal(facts(seats[1]!), { type: 'start_prep', sequence: 0 }),
      roundCommandRefusal(facts(respondent), {
        type: 'start_prep',
        sequence: 0,
      })?.kind,
    ],
    expected: [null, null, 'invariant'],
  });
  const prepping = (seat: (typeof seats)[number]): RoundCommandFacts => ({
    ...facts(seat),
    state: {
      ...facts(seat).state,
      checkpoint: {
        ...emptyRuntimeCheckpoint,
        prep: { phase: 'running', side: 'affirmative', started_at: at(0) },
      },
    },
  });
  assert({
    given: 'the affirmative prepping, read by both affirmatives and the negative',
    should: 'let either affirmative open the speech',
    actual: [
      roundCommandOptions(prepping(speaker)).map((o) => o.command.type),
      roundCommandOptions(prepping(seats[1]!)).map((o) => o.command.type),
      roundCommandOptions(prepping(respondent)).map((o) => o.command.type),
    ],
    expected: [
      ['start_speech', 'forfeit'],
      ['start_speech', 'forfeit'],
      ['forfeit'],
    ],
  });
});

test('hydrating lifecycle columns (ISSUE-1014)', async () => {
  const hydrate = (round: {
    readonly status: 'opening' | 'completed' | 'abandoned';
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly outcome: RoundOutcome | null;
  }) =>
    normalizeRoundClock({
      round,
      rules: oneOnOneRules(),
      checkpoint: emptyRuntimeCheckpoint,
      segments: [],
    }).lifecycle;
  assert({
    given: 'a completed Round and a Round abandoned in its opening',
    should: 'hold only what each status has',
    actual: [
      hydrate({
        status: 'completed',
        startedAt: at(0),
        completedAt: at(5),
        outcome: winnerOutcome('affirmative'),
      }),
      hydrate({
        status: 'abandoned',
        startedAt: null,
        completedAt: at(5),
        outcome: null,
      }),
    ],
    expected: [
      {
        status: 'completed',
        startedAtMs: instantMs(at(0)),
        completedAtMs: instantMs(at(5)),
        outcome: winnerOutcome('affirmative'),
      },
      {
        status: 'abandoned',
        startedAtMs: null,
        completedAtMs: instantMs(at(5)),
      },
    ],
  });
  for (const round of [
    {
      status: 'opening',
      startedAt: at(0),
      completedAt: null,
      outcome: null,
    },
    {
      status: 'completed',
      startedAt: null,
      completedAt: at(5),
      outcome: null,
    },
    {
      status: 'abandoned',
      startedAt: at(0),
      completedAt: at(5),
      outcome: winnerOutcome('affirmative'),
    },
  ] as const)
    await assertRejects({
      given: `a ${round.status} Round with columns its status cannot hold`,
      should: 'refuse the corrupt lifecycle',
      actual: async () => hydrate(round),
      code: 'INVARIANT',
      invariantId: 'round.lifecycle.matches-status',
    });
});
