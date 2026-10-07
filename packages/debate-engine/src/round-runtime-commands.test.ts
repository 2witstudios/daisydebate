import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  completedSchedule,
  practiceCast,
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
});
