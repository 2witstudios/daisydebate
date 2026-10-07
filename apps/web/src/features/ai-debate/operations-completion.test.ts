import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import type { Ballot } from '@daisy/protocol';
import { setup } from './operations.test-support';

setupRitewayBun();

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
