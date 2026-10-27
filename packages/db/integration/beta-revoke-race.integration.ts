import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { participantAccess } from '@daisy/auth/authorization';
import { lockAuthorizationActors } from '../src/authorization';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('a command waiting on the account fence sees a revoke that commits first (ADR 0075)', async () => {
  await withFixture(url, async (fixture) => {
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    const blocker = new SQL(url, { max: 1 });
    const command = new SQL(url, { max: 1 });
    try {
      // The command's own single connection, so the probe watches exactly it.
      const [own] = await command`select pg_backend_pid() as pid`;
      // The operator's revoke holds the account row, as its command does.
      await blocker.unsafe('begin');
      await blocker.unsafe(
        "update account_beta_access set state='revoked', revision=revision+1, decided_at=now() where user_id=$1",
        [userId],
      );
      await blocker.unsafe('update users set version=version+1 where id=$1', [
        userId,
      ]);
      // A participant command locks the same account under the fence.
      const fenced = drizzle({ client: command }).transaction((tx) =>
        lockAuthorizationActors(tx, [actorId], { maxActors: 1 }),
      );
      let waiting = false;
      for (let attempt = 0; attempt < 500 && !waiting; attempt += 1) {
        const [row] =
          await fixture.sql`select exists(select 1 from pg_stat_activity where pid = ${own?.pid} and wait_event_type = 'Lock') as waiting`;
        waiting = row.waiting;
      }
      await blocker.unsafe('commit');
      const [fact] = await fenced;
      assert({
        given:
          'an approved participant whose command waits on the account fence while a revoke commits',
        should:
          'actually wait, then read the revoked fact and deny participant access',
        actual: {
          waiting,
          beta: fact?.beta?.state ?? null,
          admitted: participantAccess(fact ?? null),
        },
        expected: { waiting: true, beta: 'revoked', admitted: false },
      });
    } finally {
      await blocker.close();
      await command.close();
    }
  });
});
