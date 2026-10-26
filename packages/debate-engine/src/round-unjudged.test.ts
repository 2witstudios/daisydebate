import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import type { CompetitionType } from '@daisy/protocol';
import {
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
  runtimeWorld,
} from './runtime.test-support';

setupRitewayBun();
const rules = {
  ...oneOnOneRules(),
  seats: { affirmative: 1, negative: 1, judge: 0 },
};
const participants = oneOnOneSeats.filter((seat) => seat.role !== 'judge');
const total = rules.segments.reduce(
  (sum, s) => sum + s.durationMs + rules.countdownMs,
  0,
);
/** Completion facts with no ballots and a deadline that has long passed. */
const facts = (competitionType: CompetitionType, now: string) => ({
  competitionType,
  now,
  ballots: [],
  ballotDeadlineAt: roundAt(0),
  completeness: 'complete' as const,
  humanJudgeSeatIds: [],
});
const played = () => {
  const world = runtimeWorld({ rules, participants });
  world.execute({ command: { type: 'start' }, actorId: null, now: roundAt(0) });
  world.tick(roundAt(total));
  return world;
};

/** Rehydrate actual engine projections with deliberately inconsistent cast evidence. */
const closedWith = (overrides: Parameters<typeof runtimeWorld>[0]) => {
  const source = runtimeWorld({ rules, participants });
  source.execute({
    command: { type: 'start' },
    actorId: null,
    now: roundAt(0),
  });
  const projected = source.tick(roundAt(total));
  return runtimeWorld({
    rules,
    participants,
    status: 'active',
    segments: projected.segmentInserts.map((row) => ({
      ...row,
      endedAt: projected.segmentCloses.find((close) => close.id === row.id)!
        .endedAt,
    })),
    ...overrides,
  });
};

test('zero-judge casual completion projects an unjudged terminal result in the shared engine', () => {
  const world = played();
  const result = world.completeUnjudged(
    facts('casual', roundAt(total + 120_000)),
  );
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
    {
      world: closedWith({ participants: oneOnOneSeats }),
      competitionType: 'casual' as const,
    },
    {
      world: closedWith({ rules: oneOnOneRules() }),
      competitionType: 'casual' as const,
    },
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
        world.completeUnjudged(
          facts(competitionType, roundAt(total + 120_000)),
        ),
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

test('unjudged completion does not accept a clock before the actual final end', async () => {
  for (const now of [roundAt(total - 1), 'invalid']) {
    const world = played();
    const before = world.position(roundAt(total));
    await assertRejects({
      given: now,
      should: 'refuse time preceding actual final closure',
      actual: () => world.completeUnjudged(facts('casual', now)),
      code: 'INVARIANT',
      invariantId: 'round.complete.unjudged-casual-only',
    });
    assert({
      given: now,
      should: 'preserve terminal eligibility after refusal',
      actual: world.position(roundAt(total)),
      expected: before,
    });
  }
});
