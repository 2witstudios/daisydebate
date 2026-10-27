import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { sqlStateOf, withFixture } from './constraint-helpers';

const { databaseUrl: url } = requireTestServices(process.env);
setupRitewayBun();

/**
 * Holds `fence` open in one transaction while `attempt` runs in another
 * with a short lock_timeout: 'accepted' means it never waited on the held
 * fence, 55P03 means it had to.
 */
async function whileHeld(
  fence: (sql: SQL) => Promise<unknown>,
  attempt: (sql: SQL) => Promise<unknown>,
) {
  const holder = new SQL(url);
  const other = new SQL(url);
  try {
    const held = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const holding = holder.begin(async (tx) => {
      await fence(tx);
      held.resolve();
      await release.promise;
    });
    await held.promise;
    const outcome = await sqlStateOf(() =>
      other.begin(async (tx) => {
        await tx`set local lock_timeout = '300ms'`;
        await attempt(tx);
      }),
    );
    release.resolve();
    await holding;
    return outcome;
  } finally {
    await holder.close();
    await other.close();
  }
}

const readAccounts = (actorId: string) => (sql: SQL) =>
  sql`select * from public.daisy_authorization_read_accounts_v2(array[${actorId}]::text[])`;
const lockAccounts = (actorId: string) => (sql: SQL) =>
  sql`select * from public.daisy_authorization_accounts_v2(array[${actorId}]::text[], null::text, true)`;

describe('read-compatible authority fences (MSG-2.1-arch1)', () => {
  test('two readers of one account pass the fence together; a writer waits for them', async () => {
    await withFixture(url, async (fixture) => {
      const actorId = await fixture.actor();
      assert({
        given: 'one transaction holding the shared account fence',
        should:
          'let a second reader through at once and make an exclusive writer wait',
        actual: {
          reader: await whileHeld(readAccounts(actorId), readAccounts(actorId)),
          writer: await whileHeld(readAccounts(actorId), lockAccounts(actorId)),
          readerBehindWriter: await whileHeld(
            lockAccounts(actorId),
            readAccounts(actorId),
          ),
        },
        expected: {
          reader: 'accepted',
          writer: '55P03',
          readerBehindWriter: '55P03',
        },
      });
    });
  });

  test('the age reader takes the shared fence, so it never serializes readers', async () => {
    await withFixture(url, async (fixture) => {
      const userId = await fixture.user();
      const actorId = await fixture.actor(userId);
      const [{ version }] =
        await fixture.sql`select version from users where id=${userId}`;
      const age = (sql: SQL) =>
        sql`select * from public.daisy_authorization_age(${userId}, ${actorId}, ${version}::integer, now())`;
      assert({
        given: 'one age read holding its account fence',
        should: 'let another age read and a plain reader through at once',
        actual: [
          await whileHeld(age, age),
          await whileHeld(age, readAccounts(actorId)),
        ],
        expected: ['accepted', 'accepted'],
      });
    });
  });
});
