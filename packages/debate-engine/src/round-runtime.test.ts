import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { practiceSeats, roundAt, runtimeWorld } from './runtime.test-support';

setupRitewayBun();

const at = roundAt;

describe('round runtime lifecycle', () => {
  test('starts a scheduled round into the countdown with the clock anchored', () => {
    const world = runtimeWorld();
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
    const world = runtimeWorld();
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
    const world = runtimeWorld({
      participants: practiceSeats.filter((seat) => seat.role !== 'negative'),
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
});
