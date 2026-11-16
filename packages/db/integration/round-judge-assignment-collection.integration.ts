import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/bun-sql/postgres';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { roundBallotReads } from '../src/round-ballot-reads';
import { constructBallotRound } from './ballot-round-construction.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('judge assignment collection shares one transaction without retaining unrelated Round locks', async () => {
  await withFixture(url, async (f) => {
    const first = await constructBallotRound(f);
    const judge = first.judges[0]!;
    const second = await constructBallotRound(f, {
      judgeActorId: judge.actorId,
    });
    await f.sql`update rounds set status='active',current_stage='live',started_at=${new Date(0)} where id in (${first.roundId},${second.roundId})`;
    const [person] =
      await f.sql`select user_id from actors where id=${judge.actorId}`;
    const userId = String(person!.user_id);
    await f.sql`update users set email_verified=true where id=${userId}`;
    const database = drizzle({ client: f.sql });
    let transactions = 0;
    const original = database.transaction.bind(database);
    database.transaction = <T>(
      callback: (
        tx: Parameters<Parameters<typeof original>[0]>[0],
      ) => Promise<T>,
      config?: Parameters<typeof original>[1],
    ) => {
      transactions++;
      return original(callback, config);
    };
    const store = roundBallotReads({ database });
    const input = {
      caller: { actorId: judge.actorId, userId },
      authorize: () => true,
      readEventDecision: () => true,
      readOpening: () => {
        throw new Error('These Rounds are active');
      },
    };
    const assigned = await store.listRoundJudgeAssignments(input);
    assert({
      given: 'the same judge seated in two real Rounds',
      should:
        'return both current assignments using one connection transaction',
      actual: [transactions, assigned.map((a) => a.roundId).sort()],
      expected: [1, [first.roundId, second.roundId].sort()],
    });
    const narrowed = await store.listRoundJudgeAssignments({
      ...input,
      authorize: (round) => round.id === second.roundId,
    });
    assert({
      given: 'a Round refused by current authorization',
      should: 'omit it while continuing to the authorized Round',
      actual: narrowed.map((a) => a.roundId),
      expected: [second.roundId],
    });
    // PostgreSQL releases locks taken after a savepoint when it rolls back to it.
    // The collection uses this boundary so its next Round cannot invert parents.
    await original(async (tx) => {
      await tx.execute(sql`savepoint assignment_lock_proof`);
      await tx.execute(
        sql`select id from rounds where id=${first.roundId} for share`,
      );
      await tx.execute(sql`rollback to savepoint assignment_lock_proof`);
      await f.sql.begin(async (other) => {
        await other`select id from rounds where id=${first.roundId} for update nowait`;
      });
      await tx.execute(sql`release savepoint assignment_lock_proof`);
    });
    await f.sql`update users set username='' where id=${userId}`;
    await assertRejects({
      given: 'a revoked membership at the next collection read',
      should: 'recheck the account before returning any assignment',
      actual: () => store.listRoundJudgeAssignments(input),
      code: 'AUTHORIZATION',
    });
  });
});
