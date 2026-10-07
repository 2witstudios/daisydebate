import { assertRejects } from '@daisy/errors/testing';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Ballot } from '@daisy/protocol';
import { setup } from './operations.test-support';

setupRitewayBun();

describe('start and view', () => {
  test('a person starts a practice round and only they can see it', async () => {
    const { operations, begin } = setup();
    const id = await begin();
    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'a new practice round with untidy spacing in the resolution',
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

  test('refuses an unknown opponent and a short resolution', async () => {
    const { operations } = setup();
    await assertRejects({
      given: 'an opponent no Train bot is',
      should: 'refuse with VALIDATION',
      actual: () =>
        operations.start({
          actorId: 'a',
          resolution: 'Resolved: x y',
          personSide: 'negative',
          opponent: 'robot',
        }),
      code: 'VALIDATION',
    });
    await assertRejects({
      given: 'a resolution of two characters',
      should: 'refuse with VALIDATION',
      actual: () =>
        operations.start({
          actorId: 'a',
          resolution: 'ok',
          personSide: 'negative',
          opponent: 'wren',
        }),
      code: 'VALIDATION',
    });
  });

  test('refuses the fourth debate in a day under a three-a-day limit', async () => {
    const { operations } = setup({ live: 25, perDay: 3 });
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await operations.start({
        actorId: 'actor-1',
        resolution: 'Resolved: practice makes patterns',
        personSide: 'affirmative',
        opponent: 'wren',
      });
    }
    await assertRejects({
      given: 'a fourth start inside the window',
      should: 'refuse with RATE_LIMIT',
      actual: () =>
        operations.start({
          actorId: 'actor-1',
          resolution: 'Resolved: practice makes patterns',
          personSide: 'affirmative',
          opponent: 'wren',
        }),
      code: 'RATE_LIMIT',
    });
  });

  // The cutover deleted `countLiveAiDebates` with the table it read, and left
  // `limits.live` declared but unread: every member's personal allowance
  // multiplied out with no global ceiling at all.
  test('refuses a new debate once the live ceiling is reached, whoever asks', async () => {
    const { operations } = setup({ live: 2, perDay: 50 });
    const start = (actorId: string) =>
      operations.start({
        actorId,
        resolution: 'Resolved: practice makes patterns',
        personSide: 'affirmative',
        opponent: 'wren',
      });
    await start('actor-1');
    await start('actor-2');
    await assertRejects({
      given: 'a third actor starting while two rounds are still live',
      should: 'refuse with RATE_LIMIT',
      actual: () => start('actor-3'),
      code: 'RATE_LIMIT',
    });
  });
});

describe('commands and the ballot', () => {
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
describe('the ruling and the completion are one write', () => {
  const judgeSeatOf = async (
    store: Awaited<ReturnType<typeof setup>>['store'],
    id: string,
  ) => {
    const round = await store.getRound(id);
    const seat = round?.participants.find((s) => s.role === 'judge');
    if (!seat) throw new Error('the judge has no seat');
    return seat.id;
  };

  const CATEGORIES = [
    'thesis',
    'framework',
    'analysis',
    'refutation',
    'impact',
    'weighing',
    'questioning',
    'answering',
    'organization',
    'delivery',
  ] as const;
  const scoring = (mine: number): Ballot['scores']['affirmative'] =>
    Object.fromEntries(
      CATEGORIES.map((category) => [category, mine]),
    ) as Ballot['scores']['affirmative'];
  const ruling = (winner: 'affirmative' | 'negative'): Ballot => ({
    rubricVersion: 'speaker-10@1',
    winner,
    scores: { affirmative: scoring(4), negative: scoring(3) },
    reason: 'The reasoning was clearer.',
    feedback: {},
  });

  test('a completion that loses its race leaves no ruling behind', async () => {
    const { operations, store, begin, clock } = setup();
    const id = await begin();
    clock.advance(900); // the debate runs out and awaits a ruling
    const judgeSeatId = await judgeSeatOf(store, id);
    const before = await operations.view({ actorId: 'actor-1', id });

    // `version - 1` is the shape a concurrent write leaves behind: the round
    // moved on after the caller read its version.
    const raced = await store
      .applyRoundCompletion({
        roundId: id,
        expectedVersion: before.version - 1,
        ballot: {
          ballotId: 'ballot-race',
          judgeParticipantId: judgeSeatId,
          ballot: ruling('affirmative'),
        },
        command: {
          commandId: 'cmd-race',
          actorId: null,
          serviceId: 'ai-judge',
          type: 'complete',
          payloadDigest: 'a'.repeat(64),
          result: { outcome: 'affirmative' },
        },
        projection: {
          round: {
            status: 'completed',
            currentStage: null,
            startedAt: null,
            completedAt: null,
            outcome: 'affirmative',
            checkpoint: { ...before.checkpoint },
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        },
      })
      .then(() => 'accepted')
      .catch(() => 'refused');

    assert({
      given: 'a completion whose version is one behind',
      should: 'refuse, so nothing is written',
      actual: raced,
      expected: 'refused',
    });
    assert({
      given: 'the refused completion',
      should: 'leave the round with no ruling on file',
      actual: (await operations.view({ actorId: 'actor-1', id })).ballot,
      expected: null,
    });
  });

  test('a ruling stranded by an earlier failure still completes the round', async () => {
    const { operations, store, begin, clock } = setup();
    const id = await begin();
    clock.advance(3 * 3600); // the debate has run out and awaits a ruling
    const judgeSeatId = await judgeSeatOf(store, id);

    // Exactly the stranded state the old two-commit path produced: a submitted
    // ballot against a round that is still active and awaiting one.
    await store.submitBallot({
      ballotId: 'ballot-stranded',
      judgeParticipantId: judgeSeatId,
      ballot: ruling('negative'),
    });

    await operations.ballot({ actorId: 'actor-1', id });

    const view = await operations.view({ actorId: 'actor-1', id });
    assert({
      given: 'a round with a ruling on file that is still active',
      should: 'complete, rather than return early and stay active for good',
      actual: {
        status: view.status,
        ballotWinner: view.ballot?.winner ?? null,
      },
      expected: { status: 'completed', ballotWinner: 'negative' },
    });
  });
});
