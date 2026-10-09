import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { openFirstCrossExamination, setup } from './operations.test-support';

setupRitewayBun();

describe('persisted practice runtime view', () => {
  test('a participant reads a persisted practice round and another actor is masked', async () => {
    const { operations, begin } = setup();
    const id = await begin();
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'a persisted practice round with frozen topic',
      should: 'store the tidied resolution as a scheduled round',
      actual: {
        resolution: view.resolution,
        status: view.status,
        segments: view.rules.segments.length,
      },
      expected: {
        resolution: 'Social media does more harm than good',
        status: 'active',
        segments: 7,
      },
    });
    await assertRejects({
      given: 'another actor asking for it',
      should: 'answer NOT_FOUND',
      actual: () => operations.view({ actorId: 'actor-2', id }),
      code: 'NOT_FOUND',
    });
  });
});

describe('commands and the ballot', () => {
  test('a command at the clock edge accepts the version before its own tick', async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    const version = (await operations.view({ actorId: 'actor-1', id })).version;
    clock.advance(11);
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'yield', segmentIndex: 0 },
      expectedVersion: version,
    });
    assert({
      given:
        'the command itself materializes the first segment before yielding it',
      should:
        'apply both tick and command without treating its own tick as a rival writer',
      actual: (await operations.view({ actorId: 'actor-1', id })).version,
      expected: version + 2,
    });
  });

  test('the browser ends a bot-held cross-examination only after its line is complete', async () => {
    const { operations, begin, clock, store } = setup();
    const id = await begin();
    await openFirstCrossExamination(operations, clock, id);
    const before = await operations.view({ actorId: 'actor-1', id });
    await assertRejects({
      given:
        'the bot holds the first cross-examination but has no finished line',
      should: 'refuse the browser yield',
      actual: () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'yield', segmentIndex: 1 },
          expectedVersion: before.version,
        }),
      code: 'CONFLICT',
    });
    const round = await store.getRound(id);
    const segment = round?.segments.find((row) => row.sequence === 1);
    const bot = round?.participants.find((seat) => seat.role === 'negative');
    if (!segment || !bot) throw new Error('the bot turn did not open');
    await store.appendUtterance({
      id: 'bot-question',
      roundId: id,
      segmentId: segment.id,
      roundParticipantId: bot.id,
      text: 'A question?',
      complete: true,
      requireOpen: true,
    });
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'yield', segmentIndex: 1 },
      expectedVersion: before.version,
    });
    assert({
      given: 'the bot line is finished',
      should: 'let the bot seat yield through the service command',
      actual: (await operations.view({ actorId: 'actor-1', id })).version,
      expected: before.version + 1,
    });
  });

  test('a stale version is refused before the engine sees the command', async () => {
    const { operations, begin } = setup();
    const id = await begin();
    const { version } = await operations.view({ actorId: 'actor-1', id });
    await assertRejects({
      given: 'a command carrying a version one behind the round',
      should: 'refuse with CONFLICT, leaving the round where it was',
      actual: () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'start' },
          expectedVersion: version - 1,
        }),
      code: 'CONFLICT',
    });
    assert({
      given: 'the refused command',
      should: 'leave the round at its own version',
      actual: (await operations.view({ actorId: 'actor-1', id })).version,
      expected: version,
    });
  });

  test('a refused command changes nothing', async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    clock.advance(11); // the AC opens
    // The version the round is actually at: a command carrying a stale one is
    // refused before the engine ever sees it.
    const expectedVersion = (await operations.view({ actorId: 'actor-1', id }))
      .version;
    await assertRejects({
      given: 'a startSpeech while the AC is live',
      should: 'refuse with the prep invariant',
      actual: () =>
        operations.command({
          actorId: 'actor-1',
          id,
          command: { type: 'startSpeech' },
          expectedVersion,
        }),
      code: 'INVARIANT',
      invariantId: 'round.speech.requires-prep',
    });
    assert({
      given: 'the refused command',
      should: "leave the round at the tick's applied version, unwritten by it",
      actual: (await operations.view({ actorId: 'actor-1', id })).version,
      expected: 3,
    });
  });

  test('judges once after the last segment and completes the round', async () => {
    const { operations, begin, clock, calls } = setup();
    const id = await begin();
    await assertRejects({
      given: 'a ballot request mid-debate',
      should: 'refuse with CONFLICT',
      actual: () => operations.ballot({ actorId: 'actor-1', id }),
      code: 'CONFLICT',
    });
    clock.advance(3 * 3600);
    const first = await operations.ballot({ actorId: 'actor-1', id });
    const second = await operations.ballot({ actorId: 'actor-1', id });
    assert({
      given: 'two ballot requests after the round is spoken out',
      should:
        'judge once, return the same ballot and complete the round with the outcome',
      actual: {
        winner: [first.winner, second.winner],
        judgeCalls: calls.filter((call) => call === 'complete').length,
        status: (await operations.view({ actorId: 'actor-1', id })).status,
      },
      expected: {
        winner: ['affirmative', 'affirmative'],
        judgeCalls: 1,
        status: 'completed',
      },
    });
  });

  test("prep precedes the person's own speeches when they ask for it", async () => {
    const { operations, begin, clock } = setup();
    const id = await begin();
    clock.advance(11); // AC opens and runs
    clock.advance(300); // AC closes by time; CX1's countdown runs
    clock.advance(130); // CX1 opens and closes; NC's countdown runs
    clock.advance(370); // NC opens and closes
    clock.advance(130); // CX2 opens and closes; 1AR's countdown runs
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: "the gap before the person's own rebuttal",
      should: 'hold the next segment open for prep, at its budget',
      actual: {
        next: view.rules.segments[4]?.key,
        budget: view.rules.inRoundPrep?.budgetMsPerSide,
      },
      expected: { next: '1AR', budget: 240_000 },
    });
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'startPrep' },
      expectedVersion: view.version,
    });
    clock.advance(60);
    await operations.command({
      actorId: 'actor-1',
      id,
      command: { type: 'startSpeech' },
      expectedVersion: (await operations.view({ actorId: 'actor-1', id }))
        .version,
    });
    const after = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'start_speech a minute into prep',
      should: 'open the segment with the elapsed prep folded',
      actual: after.checkpoint.prep_consumed_ms,
      expected: { affirmative: 60_000, negative: 0 },
    });
  });
});

// The ballot used to be inserted in its own transaction and the round
// completed in a second, guarded by the round's optimistic version. The
// completion is the one that can lose: a concurrent write made it refuse with
// CONFLICT, leaving a ballot on file against a round still `active`.
