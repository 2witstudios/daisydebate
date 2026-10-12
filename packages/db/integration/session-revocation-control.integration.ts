import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { withFixture } from './constraint-helpers';
import { createAuthorizationSubject } from './authorization.test-support';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('every live session delete appends its revocation control in the deleting transaction', async () => {
  await withFixture(url, async (f) => {
    const { userId, actorId } = await createAuthorizationSubject(f);
    const live = createId(),
      expired = createId(),
      rolledBack = createId();
    const session = (id: string, expiresAt: string) =>
      f.sql`insert into session(id,user_id,token,expires_at) values(${id},${userId},${createId()},${expiresAt}::timestamptz)`;
    await session(live, '2099-01-01T00:00:00Z');
    await session(expired, '2000-01-01T00:00:00Z');
    await session(rolledBack, '2099-01-01T00:00:00Z');
    const controls = () =>
      f.sql`select payload->'ids' as ids from outbox where topic=${`user:${actorId}:inbox`} and kind='session.revoked' order by seq`;
    try {
      await f.sql
        .begin(async (tx) => {
          await tx`delete from session where id=${rolledBack}`;
          throw new Error('rollback');
        })
        .catch(() => undefined);
      await f.sql`delete from session where id in (${live}, ${expired})`;
      assert({
        given:
          'a rolled-back delete, then a live and an expired session deleted directly (as Better Auth does)',
        should:
          'append exactly one control naming the actor and the live session, and none for the expired or rolled-back rows',
        actual: (await controls()).map((row: { ids: string[] }) => row.ids),
        expected: [[actorId, live]],
      });
    } finally {
      // Deleting the remaining live session appends its control; remove controls last.
      await f.sql`delete from session where user_id=${userId}`;
      await f.sql`delete from outbox where topic=${`user:${actorId}:inbox`}`;
    }
  });
});

test('a user without an actor has no realtime inbox to revoke', async () => {
  await withFixture(url, async (f) => {
    const userId = createId(),
      sessionId = createId();
    await f.sql`insert into users(id,email_verified) values(${userId},true)`;
    f.track('users', userId);
    await f.sql`insert into session(id,user_id,token,expires_at) values(${sessionId},${userId},${createId()},'2099-01-01T00:00:00Z')`;
    const [before] =
      await f.sql`select count(*)::int n from outbox where kind='session.revoked'`;
    await f.sql`delete from session where id=${sessionId}`;
    const [after] =
      await f.sql`select count(*)::int n from outbox where kind='session.revoked'`;
    assert({
      given: 'a live session for a user who never claimed a username',
      should: 'delete without appending a control',
      actual: after!.n - before!.n,
      expected: 0,
    });
  });
});
