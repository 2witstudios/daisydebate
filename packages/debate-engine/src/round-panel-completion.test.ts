import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
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
const facts = (now: string) => ({
  now,
  ballots: [],
  completeness: 'complete' as const,
  panel: { humanWindow: null, aiSeats: [] },
});
const played = () => {
  const world = runtimeWorld({ rules, participants });
  world.activate({ at: roundAt(0), now: roundAt(0) });
  world.tick(roundAt(total));
  return world;
};

/** Rehydrate actual engine projections with deliberately inconsistent cast evidence. */
const closedWith = (overrides: Parameters<typeof runtimeWorld>[0]) => {
  const source = runtimeWorld({ rules, participants });
  source.activate({ at: roundAt(0), now: roundAt(0) });
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

test('zero-judge completion projects an unjudged terminal result in the shared engine', () => {
  const world = played();
  const result = world.completePanel(facts(roundAt(total + 120_000)));
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

test('panel completion refuses with its invariant and preserves state', async () => {
  const cases = [
    { world: closedWith({ participants: oneOnOneSeats }) },
    { world: closedWith({ rules: oneOnOneRules() }) },
    { world: runtimeWorld({ rules, participants, status: 'active' }) },
    { world: runtimeWorld({ rules, participants, status: 'completed' }) },
    { world: runtimeWorld({ rules, participants, status: 'abandoned' }) },
    { world: runtimeWorld({ status: 'active' }) },
    { world: runtimeWorld({ rules, status: 'active' }) },
  ];
  for (const { world } of cases) {
    const before = world.position(roundAt(total + 120_000));
    await assertRejects({
      given: 'a Round not played to its end, or with judges still able to rule',
      should: 'refuse an ineligible completion',
      actual: () => world.completePanel(facts(roundAt(total + 120_000))),
      code: 'INVARIANT',
      invariantId: 'round.complete.panel-played-round',
    });
    assert({
      given: 'that refusal',
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
      actual: () => world.completePanel(facts(now)),
      code: 'INVARIANT',
      invariantId: 'round.complete.panel-played-round',
    });
    assert({
      given: now,
      should: 'preserve terminal eligibility after refusal',
      actual: world.position(roundAt(total)),
      expected: before,
    });
  }
});
