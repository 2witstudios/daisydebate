import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const instant = '2026-10-07T12:00:00.000Z';
const ballot = (): Ballot => ({
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  scores: {
    affirmative: Object.fromEntries(ballotCategories.map((key) => [key, 4])),
    negative: Object.fromEntries(ballotCategories.map((key) => [key, 3])),
  } as Ballot['scores'],
  reason: 'The affirmative made the stronger case.',
  feedback: {},
});

test('a scheduled forfeit persists abandonment without a start instant or ballot', async () => {
  await withFixture(url, async (fixture) => {
    const roundId = await fixture.round();
    const database = createDatabase({ url, nextActorId: createId });
    try {
      const before = await database.getRound(roundId);
      if (!before) throw new Error('the scheduled round did not hydrate');
      await database.applyRoundExecution({
        roundId,
        expectedVersion: before.version,
        command: null,
        projection: {
          round: {
            status: 'abandoned',
            currentStage: null,
            startedAt: null,
            completedAt: instant,
            outcome: null,
            checkpoint: before.checkpoint,
          },
          segmentInserts: [],
          segmentCloses: [],
          effects: [],
        },
      });
      const after = await database.getRound(roundId);
      assert({
        given: 'the scheduled forfeit projection at the PostgreSQL boundary',
        should: 'persist the lifecycle the schema allows',
        actual: [
          after?.status,
          after?.startedAt,
          after?.outcome,
          !!after?.completedAt,
        ],
        expected: ['abandoned', null, null, true],
      });
    } finally {
      await database.close();
    }
  });
});

test('completion refuses a judge seat from another round without writing a ballot', async () => {
  await withFixture(url, async (fixture) => {
    const target = await fixture.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date(instant),
    });
    const other = await fixture.round();
    const judge = await fixture.seat(other, 'judge');
    const database = createDatabase({ url, nextActorId: createId });
    try {
      await assertRejects({
        given: 'a valid judge seat belonging to another round',
        should: 'refuse the completion with the round-seat invariant',
        actual: () =>
          database.applyRoundCompletion({
            roundId: target,
            expectedVersion: 1,
            ballot: {
              ballotId: createId(),
              judgeParticipantId: judge.id,
              ballot: ballot(),
            },
            command: null,
            projection: {
              round: null,
              segmentCloses: [],
              segmentInserts: [],
              effects: [],
            },
          }),
        code: 'INVARIANT',
      });
      assert({
        given: 'that refused completion',
        should: 'leave the judge ballot table untouched',
        actual: await fixture.count(
          'ballots',
          'judge_participant_id',
          judge.id,
        ),
        expected: 0,
      });
    } finally {
      await database.close();
    }
  });
});
