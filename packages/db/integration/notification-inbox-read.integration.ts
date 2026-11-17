import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { notificationOperations, oweNotifications } from '../src/notifications';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

/** A public Round with a Broadcast, on air unless `stopped`. */
const broadcastRound = async (f: Fixture, stopped = false) => {
  const roundId = await f.round({ visibility: 'public' });
  await f.sql`insert into broadcasts ${f.sql({
    id: createId(),
    round_id: roundId,
    feed_key: createId(),
    release_policy: { kind: 'delay', seconds: 60 },
    stopped_at: stopped ? new Date() : null,
    stop_reason: stopped ? 'policy_violation' : null,
  })}`;
  return roundId;
};

test('the inbox pages by cursor over what still stands', async () => {
  await withFixture(databaseUrl, async (f) => {
    const debater = await createAuthorizationSubject(f);
    const member = await createAuthorizationSubject(f);
    const database = drizzle({ client: f.sql });
    const notifications = notificationOperations({ database });
    const start = Date.parse('2026-11-01T00:00:00.000Z');
    const owe = (roundId: string, minute: number) =>
      database.transaction((tx) =>
        oweNotifications(tx, {
          kind: 'followed_debater_live',
          subject: { round_id: roundId },
          recipients: [{ userId: member.userId, about: debater.actorId }],
          // Pairs share a minute, so the id breaks ties.
          at: new Date(start + Math.floor(minute / 2) * 60_000).toISOString(),
          nextId: createId,
        }),
      );
    for (let minute = 0; minute < 60; minute += 1)
      await owe(await broadcastRound(f), minute);
    await owe(await broadcastRound(f, true), 60);
    // The oldest 20 read.
    await f.sql`update notifications set read_at=now() where id in (
      select id from notifications where user_id=${member.userId}
      order by surfaced_at,id limit 20)`;
    type After = Parameters<typeof notifications.readNotifications>[0]['after'];
    const read = (after: After) =>
      notifications.readNotifications({
        userId: member.userId,
        unreadOnly: false,
        limit: 25,
        now: new Date().toISOString(),
        after,
      });
    const first = await read(null);
    const second = await read(first.next);
    const third = await read(second.next);
    const everything = await f.sql`select n.id from notifications n
      join broadcasts b on b.round_id=n.round_id and b.stopped_at is null
      where n.user_id=${member.userId} order by n.surfaced_at desc,n.id desc`;
    const paged = [...first.rows, ...second.rows, ...third.rows].map(
      (row) => row.id,
    );
    assert({
      given:
        '60 standing notifications, 20 of them read, and one whose Broadcast stopped, read 25 at a time',
      should:
        'continue each page exactly where the last ended, leave out the one that no longer stands, and count the unread it shows',
      actual: {
        pages: [first.rows.length, second.rows.length, third.rows.length],
        last: third.next,
        paged: paged.join(),
        unread: first.unread,
      },
      expected: {
        pages: [25, 25, 10],
        last: null,
        paged: everything.map((row: { id: string }) => row.id).join(),
        unread: 40,
      },
    });
  });
});

test('marking read rings every tab once, and only when something changed', async () => {
  await withFixture(databaseUrl, async (f) => {
    const debater = await createAuthorizationSubject(f);
    const member = await createAuthorizationSubject(f);
    const database = drizzle({ client: f.sql });
    const notifications = notificationOperations({ database });
    const roundId = await broadcastRound(f);
    await database.transaction((tx) =>
      oweNotifications(tx, {
        kind: 'followed_debater_live',
        subject: { round_id: roundId },
        recipients: [{ userId: member.userId, about: debater.actorId }],
        at: new Date().toISOString(),
        nextId: createId,
      }),
    );
    const [row] = await f.sql`select id from notifications
      where user_id=${member.userId}`;
    const mark = (notificationIds: readonly string[] | 'all') =>
      notifications.markNotificationsRead({
        userId: member.userId,
        notificationIds,
        at: new Date().toISOString(),
      });
    const rings = async () => {
      const [count] = await f.sql`select count(*)::int as c from outbox
        where topic=${`user:${member.actorId}:inbox`} and kind='user.notifications-read'`;
      return (count as { c: number }).c;
    };
    await mark([(row as { id: string }).id]);
    const once = await rings();
    await mark('all');
    assert({
      given: 'one notification marked read, then all marked read again',
      should: 'ring the member once, and not for the read that changed nothing',
      actual: [once, await rings()],
      expected: [1, 1],
    });
  });
});
