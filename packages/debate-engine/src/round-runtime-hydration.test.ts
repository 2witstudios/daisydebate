import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  completedSchedule,
  practiceCast,
  runtimeWorld as runtime,
} from './runtime.test-support';

setupRitewayBun();

const { rules, at } = practiceCast();

describe('round runtime hydration', () => {
  test('reconstructs the exact legal position from durable rows and the checkpoint', () => {
    const midPrep = runtime({
      status: 'active',
      checkpoint: {
        version: 1,
        prep_consumed_ms: { affirmative: 30_000, negative: 0 },
        active_prep: { side: 'affirmative', started_at: at(945_000) },
        floor: null,
      },
      segments: [
        {
          id: 'segment-1',
          sequence: 0,
          type: 'speech',
          rulesSegmentKey: 'AC',
          startedAt: at(10_000),
          endedAt: at(310_000),
          durationMs: 300_000,
        },
        {
          id: 'segment-2',
          sequence: 1,
          type: 'cross_ex',
          rulesSegmentKey: 'CX1',
          startedAt: at(320_000),
          endedAt: at(440_000),
          durationMs: 120_000,
        },
        {
          id: 'segment-3',
          sequence: 2,
          type: 'speech',
          rulesSegmentKey: 'NC',
          startedAt: at(450_000),
          endedAt: at(810_000),
          durationMs: 360_000,
        },
        {
          id: 'segment-4',
          sequence: 3,
          type: 'cross_ex',
          rulesSegmentKey: 'CX2',
          startedAt: at(820_000),
          endedAt: at(940_000),
          durationMs: 120_000,
        },
      ],
    });
    const position = midPrep.position(at(960_000));
    assert({
      given: 'a crash fifteen seconds into a prep with thirty seconds consumed',
      should: 'derive prep with the effective budget remaining',
      actual: {
        stage: position.stage,
        prep: position.prep,
        next: position.nextSegment?.key,
        budget: position.prepBudgetRemainingMs,
      },
      expected: {
        stage: 'prep',
        prep: { side: 'affirmative', remainingMs: 195_000 },
        next: '1AR',
        budget: { affirmative: 195_000, negative: 240_000 },
      },
    });
  });

  test('refuses durable rows that disagree with the rules they execute', async () => {
    const wrongDuration = () =>
      runtime({
        status: 'active',
        segments: [
          {
            id: 'segment-1',
            sequence: 0,
            type: 'speech',
            rulesSegmentKey: 'AC',
            startedAt: at(10_000),
            endedAt: at(310_000),
            durationMs: 299_000,
          },
        ],
      });
    await assertRejects({
      given: 'a closed row whose duration differs from the resolved rules',
      should: 'refuse hydration with the matches-rules invariant',
      actual: wrongDuration,
      code: 'INVARIANT',
      invariantId: 'round.segment.matches-rules',
    });
    const wrongKey = () =>
      runtime({
        status: 'active',
        segments: [
          {
            id: 'segment-1',
            sequence: 0,
            type: 'cross_ex',
            rulesSegmentKey: 'CX1',
            startedAt: at(10_000),
            endedAt: at(130_000),
            durationMs: 120_000,
          },
        ],
      });
    await assertRejects({
      given: 'a row naming a segment key its sequence does not hold',
      should: 'refuse hydration with the matches-rules invariant',
      actual: wrongKey,
      code: 'INVARIANT',
      invariantId: 'round.segment.matches-rules',
    });
    const wrongType = () =>
      runtime({
        status: 'active',
        segments: [
          {
            id: 'segment-1',
            sequence: 0,
            type: 'cross_ex',
            rulesSegmentKey: 'AC',
            startedAt: at(10_000),
            endedAt: at(310_000),
            durationMs: 300_000,
          },
        ],
      });
    await assertRejects({
      given:
        'a row with the right key and duration but the wrong interaction type',
      should: 'refuse hydration with the matches-rules invariant',
      actual: wrongType,
      code: 'INVARIANT',
      invariantId: 'round.segment.matches-rules',
    });
  });

  test('refuses durable rows that leave two segments open at once', async () => {
    const twoOpen = () =>
      runtime({
        status: 'active',
        segments: [
          {
            id: 'segment-1',
            sequence: 0,
            type: 'speech',
            rulesSegmentKey: 'AC',
            startedAt: at(10_000),
            endedAt: null,
            durationMs: 300_000,
          },
          {
            id: 'segment-2',
            sequence: 1,
            type: 'cross_ex',
            rulesSegmentKey: 'CX1',
            startedAt: at(310_000),
            endedAt: null,
            durationMs: 120_000,
          },
        ],
      });
    await assertRejects({
      given: 'an open segment row followed by another open row',
      should: 'refuse hydration with the open-segment-count invariant',
      actual: twoOpen,
      code: 'INVARIANT',
      invariantId: 'round.live.open-segment-count',
    });
  });

  test('marks the final segment as awaiting its ballot once its time is spent', () => {
    const { world, totalMs } = completedSchedule(rules);
    const position = world.position(at(totalMs + 5_000));
    assert({
      given: 'the final segment open past its end with the outcome not yet in',
      should: 'report the round as awaiting its ballot',
      actual: [
        position.awaitingBallot,
        position.stage,
        position.openSegment?.key,
      ],
      expected: [true, 'live', '2AR'],
    });
  });
});
