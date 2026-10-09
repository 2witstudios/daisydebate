import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { sql } from 'drizzle-orm';
import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from '../src/authorization';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('account authorization locks fence erasure and return fresh durable membership', async () => {
  await withFixture(url, async (fixture) => {
    const userId = createId(),
      actorId = createId();
    fixture.track('users', userId);
    fixture.track('actors', actorId);
    await fixture.sql`insert into users (id,username,email_verified) values (${userId},${userId},true)`;
    await fixture.sql`insert into actors (id,kind,user_id) values (${actorId},'human',${userId})`;
    const db = drizzle({ client: fixture.sql });
    await db.transaction(async (tx) => {
      const facts = await lockAuthorizationActors(tx, [actorId], {
        maxActors: 2,
      });
      assert({
        given: 'live verified member loaded under the command transaction',
        should: 'bind actor and current account revision',
        actual: facts,
        expected: [
          { userId, actorId, member: true, erased: false, revision: 1 },
        ],
      });
      const state = await sqlStateOf(() =>
        fixture.sql.begin(
          async (other) =>
            other`select id from users where id=${userId} for update nowait`,
        ),
      );
      assert({
        given: 'a concurrent tombstone/correction writer',
        should: 'be excluded by the account fence',
        actual: state,
        expected: '55P03',
      });
    });
    await db.execute(
      sql`update users set username=null,email=null,image=null,name='',deleted_at='2026-10-09T00:00:00Z',version=version+1 where id=${userId}`,
    );
    assert({
      given: 'the erasure committed after fence release',
      should: 'refuse membership from freshly reloaded facts',
      actual: await loadAuthorizationAccount(db, userId),
      expected: { userId, actorId, member: false, erased: true, revision: 2 },
    });
  });
});
