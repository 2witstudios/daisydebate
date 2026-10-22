import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { ballotCategories, type Ballot } from '@daisy/protocol';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundBallotOperations } from '../src/round-ballot-operations';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const ballot: Ballot = {
  rubricVersion: 'speaker-10@1',
  winner: 'affirmative',
  reason: 'The affirmative answered the decisive argument.',
  feedback: {},
  scores: {
    affirmative: Object.fromEntries(ballotCategories.map((k) => [k, 4])),
    negative: Object.fromEntries(ballotCategories.map((k) => [k, 3])),
  } as Ballot['scores'],
};

test('ballot writes require actual frozen input and replay reauthorizes without changing the original receipt', async () => {
  await withFixture(url, async (f) => {
    const roundId = await f.round({
      status: 'active',
      current_stage: 'live',
      started_at: new Date(0),
    });
    const judge = await f.seat(roundId, 'judge');
    await f.sql.unsafe(
      'update users set email_verified=true where id=(select user_id from actors where id=$1)',
      [judge.actorId],
    );
    const store = roundBallotOperations({
      database: drizzle({ client: f.sql }),
    });
    const input = {
      roundId,
      principal: { kind: 'human' as const, actorId: judge.actorId },
      envelope: {
        version: 1 as const,
        commandId: createId(),
        expectedVersion: 1,
        judgeParticipantId: judge.id,
        freezeRevision: 1,
        ballot,
      },
      payloadDigest: 'a'.repeat(64),
      nextBallotId: createId,
      authorize: () => {},
      buildProjection: () => null,
    };
    await assertRejects({
      given: 'no committed freeze',
      should: 'refuse without recording a ballot or command',
      actual: () => store.executeRoundBallot(input),
      code: 'CONFLICT',
    });
    assert({
      given: 'the missing-freeze refusal',
      should: 'leave both ledgers empty',
      actual: [
        await f.count('ballots', 'judge_participant_id', judge.id),
        await f.count('round_commands', 'command_id', input.envelope.commandId),
      ],
      expected: [0, 0],
    });
    await f.sql.unsafe(
      "insert into round_transcript_freezes(round_id,revision,frontier,completeness) values($1,1,0,'incomplete')",
      [roundId],
    );
    const receipt = await store.executeRoundBallot(input);
    f.track('ballots', receipt.ballotId);
    assert({
      given: 'the actual freeze and an assigned judge',
      should: 'pin the immutable witness and exactly replay its stored receipt',
      actual: [
        receipt.freezeRevision,
        await store.executeRoundBallot(input),
        await f.count('ballots', 'judge_participant_id', judge.id),
      ],
      expected: [1, receipt, 1],
    });
    await assertRejects({
      given: 'the same command id with another payload',
      should: 'refuse instead of duplicating the ballot',
      actual: () =>
        store.executeRoundBallot({ ...input, payloadDigest: 'b'.repeat(64) }),
      code: 'CONFLICT',
    });
    await f.sql.unsafe(
      'update users set username=$1 where id=(select user_id from actors where id=$2)',
      ['', judge.actorId],
    );
    await assertRejects({
      given: 'an accepted ballot retried after canonical membership revocation',
      should: 'refuse fresh authority before replay',
      actual: () => store.executeRoundBallot(input),
      code: 'AUTHORIZATION',
    });
  });
});
