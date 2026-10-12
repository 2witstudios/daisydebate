import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoundRuntime } from './round-runtime';
import {
  emptyCheckpoint,
  practiceRules,
  practiceSeats,
  roundAt,
} from './runtime.test-support';
setupRitewayBun();
const clockWorld = (checkpoint: unknown = emptyCheckpoint) => {
  let calls = 0;
  const runtime = createRoundRuntime({
    round: {
      id: 'round',
      status: 'active',
      currentStage: 'countdown',
      startedAt: roundAt(0),
      completedAt: null,
      outcome: null,
    },
    rules: practiceRules(),
    participants: practiceSeats,
    checkpoint,
    segments: [],
    nextSegmentId: () => `id-${++calls}`,
  });
  return { runtime, calls: () => calls };
};

test('position reads never allocate segment IDs', () => {
  const { runtime, calls } = clockWorld();
  runtime.position(roundAt(450_000));
  assert({
    given: 'an active round read past two deadlines',
    should: 'not consume any ID capability',
    actual: calls(),
    expected: 0,
  });
});

test('refused commands discard boundary advancement before allocating IDs', async () => {
  const { assertRejects } = await import('@daisy/errors/testing');
  const { runtime, calls } = clockWorld();
  const before = runtime.checkpoint();
  await assertRejects({
    given: 'start-prep precisely when scratch advancement opens the speech',
    should: 'refuse the now-live segment',
    actual: () =>
      runtime.execute({
        command: { type: 'start_prep' },
        actorId: practiceSeats[0].actorId,
        now: roundAt(10_000),
      }),
    code: 'CONFLICT',
  });
  assert({
    given: 'the refused boundary command',
    should: 'preserve state and allocate no IDs',
    actual: [runtime.checkpoint(), calls()],
    expected: [before, 0],
  });
  const caught = runtime.tick(roundAt(450_000));
  assert({
    given: 'catchup inserting and closing two intervals then opening NC',
    should: 'allocate one ID per inserted interval and reuse them for closure',
    actual: [
      calls(),
      caught.segmentInserts.map((row) => row.id),
      caught.segmentCloses.map((row) => row.id),
    ],
    expected: [3, ['id-1', 'id-2', 'id-3'], ['id-1', 'id-2']],
  });
});

test('start-speech refuses exactly at prep expiry without consuming IDs or prep', async () => {
  const { assertRejects } = await import('@daisy/errors/testing');
  const { runtime, calls } = clockWorld({
    ...emptyCheckpoint,
    active_prep: { side: 'affirmative', started_at: roundAt(1_000) },
  });
  const before = runtime.checkpoint();
  await assertRejects({
    given: 'start-speech at the exact prep budget deadline',
    should: 'refuse after scratch expiry already opened the speech',
    actual: () =>
      runtime.execute({
        command: { type: 'start_speech' },
        actorId: practiceSeats[0].actorId,
        now: roundAt(241_000),
      }),
    code: 'INVARIANT',
    invariantId: 'round.speech.requires-prep',
  });
  assert({
    given: 'the refused start-speech',
    should: 'leave checkpoint unchanged without ID allocations',
    actual: [runtime.checkpoint(), calls()],
    expected: [before, 0],
  });
});

test('an interrupter yield credits the scheduled side, never the interrupter', () => {
  const { runtime } = clockWorld({
    ...emptyCheckpoint,
    prep_consumed_ms: { affirmative: 100_000, negative: 150_000 },
  });
  runtime.tick(roundAt(330_000));
  runtime.execute({
    command: { type: 'interrupt' },
    actorId: practiceSeats[0].actorId,
    now: roundAt(330_000),
  });
  const yielded = runtime.execute({
    command: { type: 'yield' },
    actorId: practiceSeats[0].actorId,
    now: roundAt(340_000),
  });
  assert({
    given: 'affirmative yields interrupted negative CX with 100000ms unused',
    should: 'credit negative and clear floor',
    actual: [
      yielded.round?.checkpoint.prep_consumed_ms,
      yielded.round?.checkpoint.floor,
    ],
    expected: [{ affirmative: 100_000, negative: 50_000 }, null],
  });
});
