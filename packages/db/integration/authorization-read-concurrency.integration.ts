import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  readAuthorizationActors,
  loadAuthorizationSession,
} from '../src/authorization';
import { loadAuthorizationAgeFact } from '../src/account-age';
import { withFixture, sqlStateOf } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
import { createId } from '@paralleldrive/cuid2';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

for (const role of ['daisy_web', 'daisy_realtime'])
  test(`${role}: concurrent readers include nested age/session facts and exclude account writers`, async () => {
    await withFixture(url, async (fixture) => {
      const caller = await createAuthorizationSubject(fixture);
      const sessionId = createId();
      await fixture.sql`insert into account_age(user_id,birth_month,version,recorded_at) values(${caller.userId},'1990-01',1,'2020-01-01')`;
      await fixture.sql`insert into session(id,user_id,token,expires_at) values(${sessionId},${caller.userId},${createId()},clock_timestamp()+interval '1 day')`;
      const peer = new SQL(url, { max: 1 });
      try {
        await fixture.sql.begin(async (client) => {
          await client.unsafe(`set local role ${role}`);
          const db = drizzle({ client });
          const [account] = await readAuthorizationActors(
            db,
            [caller.actorId],
            { maxActors: 1 },
          );
          const [now] = await client`select clock_timestamp() as now`;
          const firstAge = await loadAuthorizationAgeFact(db, {
            ...caller,
            accountRevision: account!.revision,
            now: now.now.toISOString(),
          });
          const firstSession = await loadAuthorizationSession(db, {
            ...caller,
            sessionId,
            now: now.now.toISOString(),
          });
          const result = await peer.begin(async (other) => {
            await other.unsafe(`set local role ${role}`);
            await other`set local lock_timeout='100ms'`;
            const otherDb = drizzle({ client: other });
            const [next] = await readAuthorizationActors(
              otherDb,
              [caller.actorId],
              { maxActors: 1 },
            );
            const age = await loadAuthorizationAgeFact(otherDb, {
              ...caller,
              accountRevision: next!.revision,
              now: now.now.toISOString(),
            });
            const session = await loadAuthorizationSession(otherDb, {
              ...caller,
              sessionId,
              now: now.now.toISOString(),
            });
            return {
              member: next?.member,
              age: age.state,
              session: session?.actorId,
            };
          });
          const writer = await sqlStateOf(
            () =>
              peer`select id from users where id=${caller.userId} for update nowait`,
          );
          assert({
            given: 'one reader remains behind a controlled post-fence barrier',
            should:
              'permit the second complete fact producer and refuse exclusive account mutation',
            actual: {
              firstAge: firstAge.state,
              firstSession: firstSession?.actorId,
              result,
              writer,
            },
            expected: {
              firstAge: 'known',
              firstSession: caller.actorId,
              result: { member: true, age: 'known', session: caller.actorId },
              writer: '55P03',
            },
          });
        });
      } finally {
        await peer.close();
        await fixture.sql`delete from account_age where user_id=${caller.userId}`;
        await fixture.sql`delete from session where id=${sessionId}`;
      }
    });
  });
