import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { RoundRules } from '@daisy/protocol';
import { createRoundRuntime } from './round-runtime';
import { practiceRules, sequentialSegmentIds } from './runtime.test-support';

setupRitewayBun();

const rules: RoundRules = practiceRules();

const t0 = '2026-10-06T09:00:00.000Z';
const at = (ms: number) => new Date(Date.parse(t0) + ms).toISOString();
const person = 'k2v9x0f4m8q3w1z7c5n6b4d2';
const opponent = 'a7b3c9d1e5f2k4m6n8p1r3t5';
const judge = 'c8d4e2f6a1b3k5m7n9p2r4t6';

const seats = [
  {
    id: 'm3w8k1z5c9b2n7p4r6t0v2x4',
    actorId: person,
    role: 'affirmative',
    slot: 0,
  },
  {
    id: 'q5x2v8t0r4p6n2b8c1z7k3m9w',
    actorId: opponent,
    role: 'negative',
    slot: 0,
  },
  { id: 'd6y3h9j1f5a7s3g8l2q6e4u0i', actorId: judge, role: 'judge', slot: 0 },
] as const;

interface Options {
  readonly status?: 'scheduled' | 'active' | 'completed' | 'abandoned';
  readonly segments?: Parameters<typeof createRoundRuntime>[0]['segments'];
  readonly checkpoint?: unknown;
}

const runtime = ({
  status = 'scheduled',
  segments = [],
  checkpoint = {
    version: 1,
    prep_consumed_ms: { affirmative: 0, negative: 0 },
    active_prep: null,
    floor: null,
  },
}: Options = {}) =>
  createRoundRuntime({
    round: {
      id: 'round-1',
      status,
      currentStage: null,
      startedAt: null,
      completedAt: null,
      outcome: null,
    },
    rules,
    participants: [...seats],
    checkpoint,
    segments,
    nextSegmentId: sequentialSegmentIds(),
  });

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
        budget: { affirmative: 210_000, negative: 240_000 },
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
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    const totalMs =
      7 * 10_000 +
      rules.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
    world.tick(at(totalMs));
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
