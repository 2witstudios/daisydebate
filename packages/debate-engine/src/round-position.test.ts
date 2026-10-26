import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { roundPositionAt } from './round-position';
import { advanceRoundClock } from './round-clock';
import { normalizeRoundClock, type ClockState } from './round-clock-state';
import { createRoundRuntime } from './round-runtime';
import {
  emptyCheckpoint,
  oneOnOneRules,
  oneOnOneSeats,
  roundAt,
} from './runtime.test-support';
setupRitewayBun();
const rules = oneOnOneRules();
const origin = Date.parse(roundAt(0));
const round = {
  status: 'active' as const,
  startedAt: roundAt(0),
  completedAt: null,
  outcome: null,
};
const snapshot = { round, rules, checkpoint: emptyCheckpoint, segments: [] };
const read = (now: number) =>
  roundPositionAt({ ...snapshot, nowMs: origin + now });
const state = () => normalizeRoundClock(snapshot);

const firstTwoSegments = (secondStartMs: number) =>
  rules.segments.slice(0, 2).map((segment, sequence) => ({
    id: `row-${sequence}`,
    sequence,
    type: segment.type,
    rulesSegmentKey: segment.key,
    durationMs: segment.durationMs,
    startedAt: roundAt(sequence === 0 ? 10_000 : secondStartMs),
    endedAt: sequence === 0 ? roundAt(310_000) : null,
  }));

for (const offset of [-1, 0, 1])
  test(`countdown and speech deadline ${offset}ms`, () => {
    const first = read(10_000 + offset);
    const close = read(310_000 + offset);
    assert({
      given: `countdown deadline ${offset}ms`,
      should: 'open exactly at the deadline',
      actual: [first.stage, first.openSegment?.sequence ?? null],
      expected:
        offset < 0
          ? ['countdown', null]
          : (['live', 0] as (string | number | null)[]),
    });
    assert({
      given: `speech deadline ${offset}ms`,
      should: 'close exactly at the deadline',
      actual: [
        close.stage,
        close.openSegment?.sequence ?? null,
        close.countdownRemainingMs,
      ],
      expected:
        offset < 0 ? ['live', 0, null] : ['countdown', null, 10_000 - offset],
    });
  });

test('interrupted CX closes and clears floor before the next speech', () => {
  const segments = firstTwoSegments(320_000);
  const checkpoint = {
    ...emptyCheckpoint,
    floor: {
      holder_participant_id: oneOnOneSeats[0].id,
      granted_at: roundAt(330_000),
    },
  };
  const input = { round, segments, rules, checkpoint, nowMs: origin + 450_000 };
  const runtime = createRoundRuntime({
    ...input,
    round: { ...round, id: 'round', currentStage: 'live' },
    participants: oneOnOneSeats,
    nextSegmentId: () => {
      throw new Error('read allocated an ID');
    },
  });
  const position = roundPositionAt(input);
  assert({
    given: 'an affirmative interruption in CX1 then NC at 450000ms',
    should: 'drop the previous floor',
    actual: [
      position.openSegment?.key,
      position.openSegment?.floorParticipantId,
    ],
    expected: ['NC', null],
  });
  assert({
    given: 'the identical durable server and browser snapshot',
    should: 'produce equal positions',
    actual: runtime.position(roundAt(450_000)),
    expected: position,
  });
  assert({
    given: 'pure prediction',
    should: 'preserve the persisted interruption',
    actual: checkpoint.floor.holder_participant_id,
    expected: oneOnOneSeats[0].id,
  });
});

test('frozen input, multi-segment catchup, staged composition and repeated time', () => {
  const initial = state();
  Object.freeze(initial.lifecycle);
  Object.freeze(initial.checkpoint.prep_consumed_ms);
  Object.freeze(initial.checkpoint);
  Object.freeze(initial.rows);
  Object.freeze(initial);
  const first = advanceRoundClock(initial, rules, origin + 440_000);
  const second = advanceRoundClock(first.state, rules, origin + 1_300_000);
  const direct = advanceRoundClock(initial, rules, origin + 1_300_000);
  assert({
    given: 'monotonic staged time versus direct catchup',
    should: 'produce the same state and ordered changes',
    actual: {
      state: second.state,
      changes: [...first.changes, ...second.changes],
    },
    expected: direct,
  });
  assert({
    given: 'the same time repeated',
    should: 'emit no extra changes',
    actual: advanceRoundClock(direct.state, rules, origin + 1_300_000).changes,
    expected: [],
  });
  assert({
    given: 'frozen clock input',
    should: 'remain empty and active',
    actual: initial.rows,
    expected: [],
  });
});

test('prep expiry opens directly and final segment closes awaiting ballot', () => {
  const prior = advanceRoundClock(state(), rules, origin + 940_000).state;
  const prep: ClockState = {
    ...prior,
    checkpoint: {
      ...prior.checkpoint,
      active_prep: { side: 'affirmative', started_at: roundAt(945_000) },
      prep_consumed_ms: { affirmative: 60_000, negative: 0 },
    },
  };
  for (const offset of [-1, 0, 1]) {
    const advanced = advanceRoundClock(
      prep,
      rules,
      origin + 1_125_000 + offset,
    );
    assert({
      given: `prep expiry ${offset}ms`,
      should: 'consume budget and open at expiry without countdown',
      actual: [
        advanced.state.checkpoint.active_prep === null,
        advanced.state.rows.at(-1)?.key,
        advanced.state.checkpoint.prep_consumed_ms.affirmative,
      ],
      expected: offset < 0 ? [false, 'CX2', 60_000] : [true, '1AR', 240_000],
    });
  }
  const final = read(99_000_000);
  assert({
    given: 'time past the final segment',
    should: 'close the final interval while awaiting ballot',
    actual: [
      final.openSegment?.sequence,
      final.openSegment?.remainingMs,
      final.awaitingBallot,
    ],
    expected: [undefined, undefined, true],
  });
});

test('active snapshots require a durable countdown origin', async () => {
  await assertRejects({
    given: 'an active snapshot without startedAt',
    should: 'reject missing lifecycle authority',
    actual: () =>
      roundPositionAt({
        ...snapshot,
        round: { ...round, startedAt: null },
        nowMs: origin,
      }),
    code: 'INVARIANT',
    invariantId: 'round.segment.matches-rules',
  });
});

test('hydration rejects overlapping intervals before either reader advances', async () => {
  const segments = firstTwoSegments(20_000);
  const malformed = { ...snapshot, segments, nowMs: origin + 25_000 };
  await assertRejects({
    given: 'closed AC through310000 followed by CX starting20000',
    should: 'refuse impossible hydration chronology',
    actual: () =>
      roundPositionAt({ ...snapshot, segments, nowMs: origin + 25_000 }),
    code: 'INVARIANT',
    invariantId: 'round.segment.matches-rules',
  });
  await assertRejects({
    given: 'the same malformed intervals at server hydration',
    should: 'reject before creating ECS execution storage',
    actual: () =>
      createRoundRuntime({
        ...malformed,
        round: { ...round, id: 'round', currentStage: 'live' },
        participants: oneOnOneSeats,
        nextSegmentId: () => 'unused',
      }),
    code: 'INVARIANT',
    invariantId: 'round.segment.matches-rules',
  });
});
