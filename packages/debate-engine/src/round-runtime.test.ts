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

describe('round runtime lifecycle', () => {
  test('starts a scheduled round into the countdown with the clock anchored', () => {
    const world = runtime();
    assert({
      given: 'a scheduled round before its start',
      should: 'show no stage and the first segment as next',
      actual: world.position(at(0)),
      expected: {
        status: 'scheduled',
        stage: null,
        startedAt: null,
        completedAt: null,
        outcome: null,
        openSegment: null,
        nextSegment: {
          key: 'AC',
          label: 'Affirmative constructive',
          type: 'speech',
          side: 'affirmative',
          sequence: 0,
        },
        countdownRemainingMs: null,
        prep: null,
        prepBudgetRemainingMs: { affirmative: 240_000, negative: 240_000 },
        awaitingBallot: false,
      },
    });
    const projection = world.execute({
      command: { type: 'start' },
      actorId: null,
      now: at(0),
    });
    assert({
      given: 'the start command',
      should: 'activate the round into the countdown with ten seconds left',
      actual: {
        round: projection.round,
        effects: projection.effects,
        position: world.position(at(1_000)),
      },
      expected: {
        round: {
          status: 'active',
          currentStage: 'countdown',
          startedAt: at(0),
          completedAt: null,
          outcome: null,
          checkpoint: {
            version: 1,
            prep_consumed_ms: { affirmative: 0, negative: 0 },
            active_prep: null,
            floor: null,
          },
        },
        effects: [{ kind: 'round_started', at: at(0) }],
        position: {
          ...world.position(at(0)),
          status: 'active',
          stage: 'countdown',
          startedAt: at(0),
          countdownRemainingMs: 9_000,
        },
      },
    });
  });

  test('opens the first segment when the countdown elapses, and closes it at time', () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    const quiet = world.tick(at(9_999));
    assert({
      given: 'a tick one millisecond before the countdown ends',
      should: 'project nothing',
      actual: [quiet.effects.length, quiet.segmentInserts.length],
      expected: [0, 0],
    });
    const opened = world.tick(at(10_000));
    assert({
      given: 'the tick at the countdown end',
      should: 'insert the opening segment row and go live',
      actual: {
        inserts: opened.segmentInserts,
        stage: world.position(at(10_000)).stage,
      },
      expected: {
        inserts: [
          {
            id: 'segment-1',
            sequence: 0,
            type: 'speech',
            rulesSegmentKey: 'AC',
            startedAt: at(10_000),
            durationMs: 300_000,
          },
        ],
        stage: 'live',
      },
    });
    const expired = world.tick(at(310_000));
    assert({
      given: "a tick after the speech's time",
      should: 'close it at its length and hold the next countdown',
      actual: {
        closes: expired.segmentCloses,
        inserts: expired.segmentInserts,
        next: world.position(at(310_000)).nextSegment?.key,
        countdown: world.position(at(310_000)).countdownRemainingMs,
      },
      expected: {
        closes: [{ id: 'segment-1', endedAt: at(310_000) }],
        inserts: [],
        next: 'CX1',
        countdown: 10_000,
      },
    });
    const crossOpen = world.tick(at(320_000));
    assert({
      given: 'the tick at the inter-segment countdown end',
      should: 'open cross-examination',
      actual: crossOpen.segmentInserts[0]?.rulesSegmentKey,
      expected: 'CX1',
    });
  });

  test('refuses a start that would seat the round incompletely', async () => {
    const world = createRoundRuntime({
      round: {
        id: 'round-1',
        status: 'scheduled',
        currentStage: null,
        startedAt: null,
        completedAt: null,
        outcome: null,
      },
      rules,
      participants: [seats[0], seats[2]],
      checkpoint: null,
      segments: [],
      nextSegmentId: sequentialSegmentIds(),
    });
    const before = world.position(at(0));
    await assertRejects({
      given: 'a round missing its negative seat',
      should: 'refuse with the seat-completeness invariant',
      actual: () =>
        world.execute({
          command: { type: 'start' },
          actorId: null,
          now: at(0),
        }),
      code: 'INVARIANT',
      invariantId: 'round.seats.complete',
    });
    assert({
      given: 'the refused start',
      should: 'leave the round scheduled and unchanged',
      actual: world.position(at(0)),
      expected: before,
    });
  });

  test('runs elective prep for the prepping side only, folding elapsed into the budget', async () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(10_000 + 300_000)); // AC done by time; gap before CX1
    const refused = () =>
      world.execute({
        command: { type: 'start_prep' },
        actorId: person,
        now: at(310_000),
      });
    await assertRejects({
      given: 'prep before cross-examination, which the format never allows',
      should: 'refuse with the spendable-segment invariant',
      actual: refused,
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
    // After AC, CX1, NC and CX2 close by time, 1AR is the affirmative's
    // own speech; its countdown runs 940_000 to 950_000.
    world.tick(at(940_000));
    const prepared = world.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    assert({
      given: "prep before the prepping side's own rebuttal",
      should: 'anchor the prep clock and clear the countdown',
      actual: {
        checkpoint: prepared.round?.checkpoint,
        position: world.position(at(955_000)),
      },
      expected: {
        checkpoint: {
          version: 1,
          prep_consumed_ms: { affirmative: 0, negative: 0 },
          active_prep: { side: 'affirmative', started_at: at(945_000) },
          floor: null,
        },
        position: {
          ...world.position(at(955_000)),
          stage: 'prep',
          prep: { side: 'affirmative', remainingMs: 230_000 },
          countdownRemainingMs: null,
        },
      },
    });
    const spoken = world.execute({
      command: { type: 'start_speech' },
      actorId: person,
      now: at(1_005_000),
    });
    assert({
      given: 'start_speech sixty seconds into prep',
      should: 'fold the elapsed prep and open the segment',
      actual: {
        consumed: spoken.round?.checkpoint.prep_consumed_ms,
        insert: spoken.segmentInserts[0]?.rulesSegmentKey,
      },
      expected: {
        consumed: { affirmative: 60_000, negative: 0 },
        insert: '1AR',
      },
    });
  });

  test('expires running prep at its remaining budget and opens the segment', () => {
    const ready = runtime();
    ready.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    ready.tick(at(940_000)); // AC, CX1, NC and CX2 closed; 1AR's countdown runs
    ready.execute({
      command: { type: 'start_prep' },
      actorId: person,
      now: at(945_000),
    });
    const expired = ready.tick(at(945_000 + 240_000));
    assert({
      given: 'the instant the whole budget is consumed',
      should: 'open the segment with the budget folded in full',
      actual: {
        consumed: expired.round?.checkpoint.prep_consumed_ms.affirmative,
        open: ready.position(at(945_000 + 240_000)).openSegment?.key,
        activePrep: expired.round?.checkpoint.active_prep,
      },
      expected: {
        consumed: 240_000,
        open: '1AR',
        activePrep: null,
      },
    });
  });

  test('lets only the floor holder yield, and returns unused time when the rules say so', async () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(10_000));
    const before = world.position(at(20_000));
    await assertRejects({
      given: "the cross-examining side yielding the affirmative's speech",
      should: 'refuse with the yield-floor invariant',
      actual: () =>
        world.execute({
          command: { type: 'yield' },
          actorId: opponent,
          now: at(20_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    assert({
      given: 'the refused yield',
      should: 'leave the segment open and unchanged',
      actual: world.position(at(20_000)),
      expected: before,
    });
    const yielded = world.execute({
      command: { type: 'yield' },
      actorId: person,
      now: at(60_000),
    });
    assert({
      given: 'the holder yielding 250 seconds early',
      should: 'close at the yield instant and credit the unused time back',
      actual: {
        close: yielded.segmentCloses[0],
        budget: yielded.round?.checkpoint.prep_consumed_ms.affirmative,
        next: world.position(at(60_000)).nextSegment?.key,
      },
      expected: {
        close: { id: 'segment-1', endedAt: at(60_000) },
        budget: 0,
        next: 'CX1',
      },
    });
  });

  test('interrupts move the floor under the resolved policy, and nowhere else', () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(330_000)); // CX1 live, negative asking
    const interrupted = world.execute({
      command: { type: 'interrupt' },
      actorId: person,
      now: at(330_000),
    });
    assert({
      given: "the affirmative interrupting the negative's cross-examination",
      should: 'record the floor with its grant instant',
      actual: interrupted.round?.checkpoint.floor,
      expected: {
        holder_participant_id: 'm3w8k1z5c9b2n7p4r6t0v2x4',
        granted_at: at(330_000),
      },
    });
    const yielded = world.execute({
      command: { type: 'yield' },
      actorId: person,
      now: at(340_000),
    });
    assert({
      given: 'the interrupter yielding the floor they took',
      should: 'end the segment early',
      actual: yielded.segmentCloses[0]?.id,
      expected: 'segment-2',
    });
  });

  test('refuses interruptions the policy forbids', async () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(10_000));
    await assertRejects({
      given: 'an interrupt during a speech under a cross_ex_only policy',
      should: 'refuse with the interrupt-policy invariant',
      actual: () =>
        world.execute({
          command: { type: 'interrupt' },
          actorId: opponent,
          now: at(20_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.interrupt.requires-policy',
    });
  });

  test("completes only after the final segment's time, with an outcome, and is then terminal", async () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    // Advance through every segment by time: seven countdowns plus speech.
    const totalMs =
      7 * 10_000 +
      rules.segments.reduce((sum, segment) => sum + segment.durationMs, 0);
    world.tick(at(totalMs));
    await assertRejects({
      given: "a completion one millisecond before the last segment's end",
      should: 'refuse with the final-segment invariant',
      actual: () =>
        world.execute({
          command: { type: 'complete', outcome: 'affirmative' },
          actorId: null,
          now: at(totalMs - 1),
        }),
      code: 'INVARIANT',
      invariantId: 'round.complete.after-final-segment',
    });
    const completed = world.execute({
      command: { type: 'complete', outcome: 'affirmative' },
      actorId: null,
      now: at(totalMs),
    });
    assert({
      given: "the completion after the final segment's time",
      should: 'close the round with the outcome',
      actual: {
        round: completed.round,
        close: completed.segmentCloses.at(-1)?.id,
      },
      expected: {
        round: {
          status: 'completed',
          currentStage: null,
          startedAt: at(0),
          completedAt: at(totalMs),
          outcome: 'affirmative',
          checkpoint: {
            version: 1,
            prep_consumed_ms: { affirmative: 0, negative: 0 },
            active_prep: null,
            floor: null,
          },
        },
        close: 'segment-7',
      },
    });
    await assertRejects({
      given: 'any command after completion',
      should: 'refuse with the terminal invariant',
      actual: () =>
        world.execute({
          command: { type: 'complete', outcome: 'negative' },
          actorId: null,
          now: at(totalMs + 1),
        }),
      code: 'INVARIANT',
      invariantId: 'round.status.completed.terminal',
    });
  });

  test("forfeit completes with the other side's outcome", () => {
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(10_000));
    const forfeited = world.execute({
      command: { type: 'forfeit' },
      actorId: person,
      now: at(20_000),
    });
    assert({
      given: 'the affirmative forfeiting mid-speech',
      should: 'close the segment and hand the round to the negative',
      actual: {
        round: forfeited.round,
        close: forfeited.segmentCloses[0]?.id,
      },
      expected: {
        round: {
          status: 'completed',
          currentStage: null,
          startedAt: at(0),
          completedAt: at(20_000),
          outcome: 'negative',
          checkpoint: {
            version: 1,
            prep_consumed_ms: { affirmative: 0, negative: 0 },
            active_prep: null,
            floor: null,
          },
        },
        close: 'segment-1',
      },
    });
  });
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
