import { assertRejects } from '@daisy/errors/testing';
import { emptyRuntimeCheckpoint, type RoundRules } from '@daisy/protocol';
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

setupRitewayBun();

const { at, opponent } = oneOnOneCast();
const [speaker, respondent, judge] = oneOnOneSeats;

const withInterruptions = (
  interruptions: RoundRules['interaction']['interruptions'],
): RoundRules => {
  const rules = oneOnOneRules();
  return { ...rules, interaction: { ...rules.interaction, interruptions } };
};

const speechFacts = (
  rules: RoundRules,
  overrides: Partial<RoundCommandFacts> = {},
): RoundCommandFacts => ({
  rules,
  participants: oneOnOneSeats,
  seat: respondent,
  nowMs: Date.parse(at(1_000)),
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

test('open questioning keeps the scheduled floor (ISSUE-1012)', async () => {
  const world = runtimeWorld({ rules: withInterruptions({ allowed: 'open' }) });
  world.activate({ at: at(0), now: at(0) });
  world.tick(at(20_000));
  const before = world.checkpoint();
  await assertRejects({
    given: 'an opponent posting interrupt under open questioning',
    should: 'refuse with the interrupt-policy invariant',
    actual: () =>
      world.execute({
        command: { type: 'interrupt' },
        actorId: opponent,
        now: at(21_000),
      }),
    code: 'INVARIANT',
    invariantId: 'round.interrupt.requires-policy',
  });
  assert({
    given: 'the refused interrupt',
    should: 'leave the floor unchanged',
    actual: world.checkpoint(),
    expected: before,
  });
});

test('every seat gets its options from one derivation (ISSUE-1013)', () => {
  const types = (facts: RoundCommandFacts) =>
    roundCommandOptions(facts).map((option) => [option.type, option.legal]);
  const enabled = withInterruptions({
    allowed: 'enabled',
    minRemainingMs: 1_000,
  });
  assert({
    given: 'a speech under an enabled policy, read by the respondent',
    should: 'offer a legal interrupt and forfeit',
    actual: types(speechFacts(enabled)),
    expected: [
      ['interrupt', true],
      ['forfeit', true],
    ],
  });
  assert({
    given: 'the respondent inside the protected end of the speech',
    should: 'keep interrupt offered and mark it illegal',
    actual: types(
      speechFacts(enabled, {
        nowMs: Date.parse(at(enabled.segments[0]!.durationMs - 500)),
      }),
    )[0],
    expected: ['interrupt', false],
  });
  assert({
    given: 'open questioning, read by the respondent',
    should: 'offer only forfeit',
    actual: types(speechFacts(withInterruptions({ allowed: 'open' }))),
    expected: [['forfeit', true]],
  });
  assert({
    given: 'a judge',
    should: 'offer nothing',
    actual: types(speechFacts(enabled, { seat: judge })),
    expected: [],
  });
  assert({
    given: 'the speaker',
    should: 'offer their own yield and never an interrupt that is legal',
    actual: types(speechFacts(enabled, { seat: speaker })).map(
      ([type, legal]) => (type === 'interrupt' ? legal : type),
    ),
    expected: ['yield', false, 'forfeit'],
  });
});

test('prep takes the seat whose segment is next (ISSUE-1013)', () => {
  const rules = oneOnOneRules();
  const seats = [
    speaker,
    { ...speaker, id: 'teammate-seat', actorId: 'teammate', slot: 1 },
    respondent,
    judge,
  ];
  const facts = (seat: (typeof seats)[number]): RoundCommandFacts =>
    speechFacts(
      { ...rules, seats: { ...rules.seats, affirmative: 2 } },
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
    given: 'the scheduled speaker and their teammate before the speech',
    should: 'allow prep only for the scheduled seat',
    actual: [
      roundCommandRefusal(facts(speaker), 'start_prep'),
      roundCommandRefusal(facts(seats[1]!), 'start_prep')?.kind,
    ],
    expected: [null, 'invariant'],
  });
  const prepping = (seat: (typeof seats)[number]): RoundCommandFacts => ({
    ...facts(seat),
    state: {
      ...facts(seat).state,
      checkpoint: {
        ...emptyRuntimeCheckpoint,
        active_prep: { side: 'affirmative', started_at: at(0) },
      },
    },
  });
  assert({
    given: 'the scheduled speaker prepping, read by them and by their teammate',
    should: 'let only the prepping seat open the speech',
    actual: [
      roundCommandOptions(prepping(speaker)).map((option) => option.type),
      roundCommandOptions(prepping(seats[1]!)).map((option) => option.type),
    ],
    expected: [['start_speech', 'forfeit'], ['forfeit']],
  });
});

test('hydrating lifecycle columns (ISSUE-1014)', async () => {
  const hydrate = (round: {
    readonly status: 'opening' | 'completed' | 'abandoned';
    readonly startedAt: string | null;
    readonly completedAt: string | null;
    readonly outcome: 'affirmative' | null;
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
        outcome: 'affirmative',
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
        startedAtMs: Date.parse(at(0)),
        completedAtMs: Date.parse(at(5)),
        outcome: 'affirmative',
      },
      {
        status: 'abandoned',
        startedAtMs: null,
        completedAtMs: Date.parse(at(5)),
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
      outcome: 'affirmative',
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
