import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import {
  practiceRules,
  practiceSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();
const rules = {
  ...practiceRules(),
  seats: { affirmative: 1, negative: 1, judge: 0 },
};
const participants = practiceSeats.filter((seat) => seat.role !== 'judge');
const total = rules.segments.reduce(
  (sum, s) => sum + s.durationMs + rules.countdownMs,
  0,
);
const played = () => {
  const world = runtimeWorld({ rules, participants });
  world.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
  world.tick(roundAt(total));
  return world;
};

test('zero-judge casual completion projects an unjudged terminal result in the shared engine', () => {
  const world = played();
  const result = world.completeUnjudged({
    competitionType: 'casual',
    now: roundAt(total + 120_000),
  });
  assert({
    given: 'the actual closed zero-judge schedule',
    should: 'complete with no competitive outcome or fabricated ballot',
    actual: {
      status: result.round?.status,
      outcome: result.round?.outcome,
      at: result.round?.completedAt,
      writes: result.segmentCloses,
      effects: result.effects,
    },
    expected: {
      status: 'completed',
      outcome: null,
      at: roundAt(total + 120_000),
      writes: [],
      effects: [
        {
          kind: 'round_completed',
          outcome: null,
          at: roundAt(total + 120_000),
        },
      ],
    },
  });
});

test('unjudged completion refuses with the zero-judge casual invariant and preserves state', async () => {
  const cases = [
    { world: played(), competitionType: 'ranked' as const },
    { world: played(), competitionType: 'practice' as const },
    {
      world: runtimeWorld({ rules, participants, status: 'active' }),
      competitionType: 'casual' as const,
    },
    {
      world: runtimeWorld({ rules, participants, status: 'completed' }),
      competitionType: 'casual' as const,
    },
    {
      world: runtimeWorld({ rules, participants, status: 'abandoned' }),
      competitionType: 'casual' as const,
    },
    {
      world: runtimeWorld({ status: 'active' }),
      competitionType: 'casual' as const,
    },
    {
      world: runtimeWorld({ rules, status: 'active' }),
      competitionType: 'casual' as const,
    },
  ];
  for (const { world, competitionType } of cases) {
    const before = world.position(roundAt(total + 120_000));
    await assertRejects({
      given: competitionType,
      should: 'refuse an ineligible completion',
      actual: () =>
        world.completeUnjudged({
          competitionType,
          now: roundAt(total + 120_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.complete.unjudged-casual-only',
    });
    assert({
      given: competitionType,
      should: 'preserve every refused runtime fact',
      actual: world.position(roundAt(total + 120_000)),
      expected: before,
    });
  }
});
