import { daisyBallotSource } from '@daisy/protocol/ballot-definition';
import { assertRejects } from '@daisy/errors/testing';
import { daisyWinnerBallot } from '@daisy/protocol/ballot-definition';
import { isJudgeSeat } from '@daisy/protocol/seats';
import { winnerOutcome } from '@daisy/protocol/round-outcome';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  oneOnOneSeats,
  completedSchedule,
  oneOnOneCast,
  runtimeWorld as runtime,
} from './runtime.test-support';

setupRitewayBun();

const { rules, at, person, opponent } = oneOnOneCast();

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
            command: { type: 'start_speech', sequence: 0 },
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

    test('lets only the scheduled speaker yield, and returns unused time when the rules say so', async () => {
      const world = runtime();
      world.activate({ at: at(0), now: at(0) });
      world.tick(at(10_000));
      const before = world.position(at(20_000));
      await assertRejects({
        given: "the cross-examining side yielding the affirmative's speech",
        should: 'refuse with the yield-floor invariant',
        actual: () =>
          world.execute({
            command: { type: 'yield', sequence: 0 },
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
        command: { type: 'yield', sequence: 0 },
        actorId: person,
        now: at(60_000),
      });
      assert({
        given: 'the speaker yielding 250 seconds early',
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

    test('a decided panel closes the Round with its outcome, and it is then terminal', async () => {
      const { world, totalMs } = completedSchedule(rules);
      const judge = oneOnOneSeats.find((seat) => isJudgeSeat(seat.seat))!.id;
      const completed = world.completePanel({
        now: at(totalMs),
        judging: {
          source: daisyBallotSource(daisyWinnerBallot),
          ballot: daisyWinnerBallot,
          panel: { decision: 'majority', quorum: 1 },
        },
        ballots: [{ judgeParticipantId: judge, winner: 'affirmative' }],
        completeness: 'complete',
        panel: {
          humanWindow: { deadlineAt: at(totalMs + 1), seatIds: [judge] },
          aiSeats: [],
        },
      });
      assert({
        given: 'every judge ruled after the final segment',
        should: 'close the round with the outcome',
        actual: completed.round,
        expected: {
          status: 'completed',
          currentStage: null,
          startedAt: at(0),
          completedAt: at(totalMs),
          outcome: winnerOutcome('affirmative'),
          checkpoint: {
            version: 2,
            prep_consumed_ms: { affirmative: 0, negative: 0 },
            prep: { phase: 'idle' },
            point_of_information: { phase: 'none' },
            incident: { phase: 'none' },
            start_gate: null,
            clock_stops: [],
          },
        },
      });
      await assertRejects({
        given: 'any command after completion',
        should: 'refuse with the terminal invariant',
        actual: () =>
          world.execute({
            command: { type: 'yield', sequence: 6 },
            actorId: person,
            now: at(totalMs + 1),
          }),
        code: 'INVARIANT',
        invariantId: 'round.status.completed.terminal',
      });
    });

    test("forfeit completes with the other side's outcome", () => {
      const world = runtime();
      world.activate({ at: at(0), now: at(0) });
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
          actualFinalEnd: forfeited.finalSegmentEndedAt,
          close: forfeited.segmentCloses[0]?.id,
        },
        expected: {
          actualFinalEnd: at(20_000),
          round: {
            status: 'completed',
            currentStage: null,
            startedAt: at(0),
            completedAt: at(20_000),
            outcome: winnerOutcome('negative'),
            checkpoint: {
              version: 2,
              prep_consumed_ms: { affirmative: 0, negative: 0 },
              prep: { phase: 'idle' },
              point_of_information: { phase: 'none' },
              incident: { phase: 'none' },
              start_gate: null,
              clock_stops: [],
            },
          },
          close: 'segment-1',
        },
      });
    });
  });
});
