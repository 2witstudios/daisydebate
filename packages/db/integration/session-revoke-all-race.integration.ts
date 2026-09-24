import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { createDatabase } from '../src/index';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

/**
 * Which comes first for `work`: finishing, or the database reporting a
 * backend blocked on a lock `holderPid` holds (`pg_blocking_pids`, not a
 * timer). Bounded, so a revoke that neither finishes nor blocks fails
 * loudly instead of hanging the suite.
 */
async function finishedOrBlockedBehind(
  work: Promise<unknown>,
  observer: SQL,
  holderPid: number,
) {
  let finished = false;
  void work.then(
    () => (finished = true),
    () => (finished = true),
  );
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (finished) return 'finished' as const;
    const [row] = await observer.unsafe(
      'select count(*)::int as waiting from pg_stat_activity where $1 = any(pg_blocking_pids(pid))',
      [holderPid],
    );
    if ((row as { waiting: number }).waiting > 0) return 'blocked' as const;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error('revoke neither finished nor blocked within 5 s');
}

const insertSession = (sql: SQL, userId: string, token: string) =>
  sql.unsafe(
    `insert into session (id, token, user_id, expires_at)
     values ($1, $2, $3, now() + interval '1 day')`,
    [createId(), token, userId],
  );

test('ISSUE-22: a session inserted while a revoke-all is in flight never survives it', async () => {
  const userId = createId();
  const keepToken = `keep-${createId()}`;
  const racingToken = `racing-${createId()}`;
  const setup = new SQL(url, { max: 1 });
  const inserter = new SQL(url, { max: 1 });
  const observer = new SQL(url, { max: 1 });
  const database = createDatabase({ url, nextActorId: createId });
  try {
    await setup.unsafe('insert into users (id, email) values ($1, $2)', [
      userId,
      `${userId}@example.test`,
    ]);
    await insertSession(setup, userId, keepToken);

    // The interleaving that lost the race in CI (ISSUE-22): a sign-in's
    // session row is written but not yet committed when the revoke-all
    // starts, so a DELETE snapshot taken now cannot see it, and it commits
    // while the revoke-all is still in flight.
    await inserter.unsafe('begin');
    await insertSession(inserter, userId, racingToken);
    const [{ pid: inserterPid }] = (await inserter.unsafe(
      'select pg_backend_pid() as pid',
    )) as [{ pid: number }];

    const revoke = database.revokeOtherSessions(userId, keepToken);
    // Either the revoke finishes without waiting (the race is open) or the
    // database reports it blocked behind the uncommitted insert; only then
    // does the insert commit. No sleep decides the order.
    const firstOutcome = await finishedOrBlockedBehind(
      revoke,
      observer,
      inserterPid,
    );
    await inserter.unsafe('commit');
    const removed = await revoke;

    const survivors = await setup.unsafe(
      'select token from session where user_id = $1 order by token',
      [userId],
    );
    assert({
      given:
        'a session insert that commits while revokeOtherSessions is in flight for the same user',
      should:
        'serialize the two: the revoke waits for the insert, then deletes it, keeping only the kept session',
      actual: {
        firstOutcome,
        removed,
        survivors: survivors.map((row: { token: string }) => row.token),
      },
      expected: {
        firstOutcome: 'blocked',
        removed: 1,
        survivors: [keepToken],
      },
    });
  } finally {
    await inserter.unsafe('rollback').catch(() => {});
    await setup.unsafe('delete from users where id = $1', [userId]);
    await Promise.allSettled([
      setup.close(),
      inserter.close(),
      observer.close(),
      database.close(),
    ]);
  }
});
