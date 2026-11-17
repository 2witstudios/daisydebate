import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { oweNotifications } from '../src/notifications';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('one owed event writes a row and a signal per recipient not yet told', async () => {
  await withFixture(databaseUrl, async (f) => {
    const debater = await createAuthorizationSubject(f);
    const [told, first, second] = await Promise.all([
      createAuthorizationSubject(f),
      createAuthorizationSubject(f),
      createAuthorizationSubject(f),
    ]);
    const roundId = await f.round();
    const database = drizzle({ client: f.sql });
    const owe = (recipients: readonly { userId: string }[]) =>
      database.transaction((tx) =>
        oweNotifications(tx, {
          kind: 'followed_debater_live',
          subjectId: roundId,
          recipients: recipients.map(({ userId }) => ({
            userId,
            about: debater.actorId,
          })),
          at: new Date().toISOString(),
          nextId: createId,
        }),
      );
    await owe([told]);
    const written = await owe([told, first, second]);
    const rows = await f.sql`select user_id from notifications
      where round_id=${roundId} order by user_id`;
    const signals = (members: readonly { actorId: string }[]) =>
      Promise.all(
        members.map(async ({ actorId }) => {
          const [row] = await f.sql`select count(*)::int as c from outbox
            where topic=${`user:${actorId}:inbox`} and kind='user.notification-delivered'`;
          return (row as { c: number }).c;
        }),
      );
    assert({
      given:
        'one event owed to three members, one of whom was already told of it',
      should:
        'write two rows and ring each new recipient once, leaving the one already told unchanged',
      actual: {
        written,
        rows: rows.length,
        signals: await signals([told, first, second]),
      },
      expected: { written: 2, rows: 3, signals: [1, 1, 1] },
    });
  });
});

test('a recipient with no live account is owed nothing', async () => {
  await withFixture(databaseUrl, async (f) => {
    const debater = await createAuthorizationSubject(f);
    const gone = await createAuthorizationSubject(f);
    await f.sql`update users set deleted_at=now() where id=${gone.userId}`;
    const roundId = await f.round();
    const database = drizzle({ client: f.sql });
    const written = await database.transaction((tx) =>
      oweNotifications(tx, {
        kind: 'followed_debater_live',
        subjectId: roundId,
        recipients: [{ userId: gone.userId, about: debater.actorId }],
        at: new Date().toISOString(),
        nextId: createId,
      }),
    );
    assert({
      given: 'an erased member among the recipients',
      should: 'write no row and ring nothing',
      actual: written,
      expected: 0,
    });
  });
});
