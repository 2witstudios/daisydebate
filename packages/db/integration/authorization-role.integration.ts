import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  lockAuthorizationActors,
  loadAuthorizationAccount,
} from '../src/authorization';
import { withFixture, sqlStateOf } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
test('realtime uses minimal account facts and the erasure fence without raw profile or update privileges', async () => {
  await withFixture(url, async (fixture) => {
    const { userId, actorId } = await createAuthorizationSubject(fixture);
    await fixture.sql.begin(async (client) => {
      await client`set local role daisy_realtime`;
      await client`create temporary table users(id text) on commit drop`;
      const tx = drizzle({ client });
      const facts = await lockAuthorizationActors(tx, [actorId], {
        maxActors: 1,
      });
      assert({
        given: 'a read-only realtime role with a shadowing temp table',
        should: 'return only the true current minimal account projection',
        actual: facts,
        expected: [
          { userId, actorId, member: true, erased: false, revision: 1 },
        ],
      });
      assert({
        given: 'a concurrent erasure writer after realtime fences the account',
        should: 'hold the identical user row lock',
        actual: await sqlStateOf(() =>
          fixture.sql.begin(
            (other) =>
              other`select id from public.users where id=${userId} for update nowait`,
          ),
        ),
        expected: '55P03',
      });
    });
    const refused = await Promise.all(
      [
        () =>
          fixture.sql.begin(async (client) => {
            await client`set local role daisy_realtime`;
            await client`select username from public.users where id=${userId}`;
          }),
        () =>
          fixture.sql.begin(async (client) => {
            await client`set local role daisy_realtime`;
            await client`update public.users set version=version+1 where id=${userId}`;
          }),
        () =>
          fixture.sql.begin(async (client) => {
            await client`set local role daisy_realtime`;
            await client`select * from public.daisy_authorization_accounts(array['invalid']::text[],null,true)`;
          }),
        () =>
          fixture.sql.begin(async (client) => {
            await client`set local role daisy_realtime`;
            await client`select * from public.daisy_authorization_accounts(array[${actorId},${actorId}]::text[],null,true)`;
          }),
        () =>
          fixture.sql.begin(async (client) => {
            await client`set local role daisy_realtime`;
            await client`select * from public.daisy_authorization_accounts(null,null,false)`;
          }),
      ].map(sqlStateOf),
    );
    assert({
      given: 'raw profile reads, account writes and invalid selector calls',
      should: 'refuse privilege escalation and malformed function inputs',
      actual: refused,
      expected: ['42501', '42501', '22023', '22023', '22023'],
    });
    await fixture.sql`update users set username=null,email_verified=false,deleted_at='2026-10-09T00:00:00Z',version=version+1 where id=${userId}`;
    await fixture.sql.begin(async (client) => {
      await client`set local role daisy_realtime`;
      assert({
        given: 'erasure committed before the fresh role read',
        should: 'return current tombstone state without membership',
        actual: await loadAuthorizationAccount(drizzle({ client }), userId),
        expected: { userId, actorId, member: false, erased: true, revision: 2 },
      });
    });
  });
});
