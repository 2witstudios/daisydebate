import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  completedSchedule,
  practiceCast,
  practiceSeats,
  runtimeWorld as runtime,
} from './runtime.test-support';

setupRitewayBun();

const { rules, at, person, opponent } = practiceCast();

describe('round runtime lifecycle', () => {
  describe('round runtime commands', () => {
    test('refuses a speech that no prep opened', async () => {
      const world = runtime({ status: 'active' });
      const before = world.position(at(1_000));
      await assertRejects({
        given: 'a speech command with no prep running',
        should: 'refuse with the speech-requires-prep invariant',
        actual: () =>
          world.execute({
            command: { type: 'start_speech' },
            actorId: person,
            now: at(1_000),
          }),
        code: 'INVARIANT',
        invariantId: 'round.speech.requires-prep',
      });
      assert({
        given: 'the refused speech',
        should: 'leave the round counting down and unchanged',
        actual: world.position(at(1_000)),
        expected: before,
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
      const { world, totalMs } = completedSchedule(rules);
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

  test('refuses the app-error paths: a started round and a seatless interrupt', async () => {
    const started = runtime({ status: 'active' });
    await assertRejects({
      given: 'a start command against an already active round',
      should: 'refuse with a conflict, not an invariant',
      actual: () =>
        started.execute({
          command: { type: 'start' },
          actorId: null,
          now: at(0),
        }),
      code: 'CONFLICT',
    });
    // CX1 is live at 325_000: cross-examination, 115_000 remaining.
    const world = runtime();
    world.execute({ command: { type: 'start' }, actorId: null, now: at(0) });
    world.tick(at(320_000));
    await assertRejects({
      given: 'an interrupt from no seat at all',
      should: 'refuse with a conflict',
      actual: () =>
        world.execute({
          command: { type: 'interrupt' },
          actorId: null,
          now: at(325_000),
        }),
      code: 'CONFLICT',
    });
  });

  test('refuses prep once no segment remains to spend it before', async () => {
    // Every segment closed while the round is still active: no open row, no
    // segment left to spend prep before.
    const spent = runtime({
      status: 'active',
      segments: rules.segments.map((segment, index) => ({
        id: `spent-${index + 1}`,
        sequence: index,
        type: segment.type,
        rulesSegmentKey: segment.key,
        startedAt: at(index),
        endedAt: at(index + 1),
        durationMs: segment.durationMs,
      })),
    });
    await assertRejects({
      given: 'a prep command after the whole schedule has spoken',
      should: 'refuse with the spendable-segment invariant',
      actual: () =>
        spent.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
  });

  test('refuses prep whose budget died at an already-reached segment', async () => {
    const world = runtime({
      status: 'active',
      rules: {
        ...rules,
        inRoundPrep: { ...rules.inRoundPrep, expiresAtSegment: 'AC' },
      },
    });
    world.tick(at(310_000)); // AC closed by time; CX1's countdown runs
    await assertRejects({
      given: 'prep whose expiry segment has already closed',
      should: 'refuse with the spendable-segment invariant',
      actual: () =>
        world.execute({
          command: { type: 'start_prep' },
          actorId: person,
          now: at(315_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.prep.requires-spendable-segment',
    });
  });

  test('refuses a yield with no live segment and a yield the rules forbid', async () => {
    const idle = runtime({ status: 'active' });
    await assertRejects({
      given: 'a yield while no segment is open',
      should: 'refuse with the yield-requires-floor invariant',
      actual: () =>
        idle.execute({
          command: { type: 'yield' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
    const forbidden = runtime({
      status: 'active',
      rules: {
        ...rules,
        interaction: { ...rules.interaction, yield: null },
      },
    });
    await assertRejects({
      given: 'a yield the resolved rules forbid outright',
      should: 'refuse with the yield-requires-floor invariant',
      actual: () =>
        forbidden.execute({
          command: { type: 'yield' },
          actorId: person,
          now: at(1_000),
        }),
      code: 'INVARIANT',
      invariantId: 'round.yield.requires-floor',
    });
  });

  test('starts a round whose role holds several seats, in the order they arrived', async () => {
    const second = {
      id: 'n9q4w8e2r6t0y3u7i5o1p9a3s7d',
      actorId: opponent,
      role: 'negative',
      slot: 1,
    } as const;
    // The second negative seat arrives before the first: the completeness
    // check sorts the held slots before comparing them.
    const world = runtime({
      participants: [practiceSeats[0], second, practiceSeats[1], practiceSeats[2]],
      rules: {
        ...rules,
        seats: { affirmative: 1, negative: 2, judge: 1 },
      },
    });
    const projection = world.execute({
      command: { type: 'start' },
      actorId: null,
      now: at(0),
    });
    assert({
      given: 'a round whose negative role holds two seats, out of order',
      should: 'start once the held slots are exactly 0..1',
      actual: projection.round?.status,
      expected: 'active',
    });
  });
});
