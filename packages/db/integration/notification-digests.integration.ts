import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { notificationOperations, oweNotifications } from '../src/notifications';
import { createAuthorizationSubject } from './authorization.test-support';
import { withFixture, type Fixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

const MINUTE = 60_000;
const start = Date.parse('2026-11-01T12:00:00.000Z');
const minute = (n: number) => new Date(start + n * MINUTE).toISOString();

/** A member with a verified address, and a way to owe them friend requests. */
const withMember = (
  body: (env: {
    readonly f: Fixture;
    readonly member: { readonly userId: string; readonly actorId: string };
    readonly notifications: ReturnType<typeof notificationOperations>;
    /** One pending friend request from a new member, owed at minute `n`. */
    readonly request: (n: number) => Promise<void>;
    readonly digests: () => Promise<
      readonly { id: string; state: string; due: string; linked: number }[]
    >;
  }) => Promise<void>,
) =>
  withFixture(databaseUrl, async (f) => {
    const member = await createAuthorizationSubject(f);
    await f.sql`update users set email=${`${member.userId}@daisy.test`} where id=${member.userId}`;
    const database = drizzle({ client: f.sql });
    const notifications = notificationOperations({ database });
    try {
      await body({
        f,
        member,
        notifications,
        request: async (n) => {
          const asker = await createAuthorizationSubject(f);
          const [low, high] = [asker.actorId, member.actorId].sort();
          await f.sql`insert into contact_pairs(low_actor_id,high_actor_id) values(${low},${high})`;
          await f.sql`insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at)
            values(${low},${high},${asker.actorId},'pending',${minute(n)}::timestamptz)`;
          await database.transaction((tx) =>
            oweNotifications(tx, {
              kind: 'friend_request_received',
              subject: {
                friendship_low_actor_id: low!,
                friendship_high_actor_id: high!,
              },
              recipients: [{ userId: member.userId, about: asker.actorId }],
              at: minute(n),
              nextId: createId,
            }),
          );
        },
        digests: async () =>
          (await f.sql`select d.id,d.state,
              to_char(d.next_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as due,
              (select count(*)::int from notifications n where n.digest_id=d.id) as linked
            from notification_digests d where d.user_id=${member.userId}
            order by d.created_at,d.id`) as {
            id: string;
            state: string;
            due: string;
            linked: number;
          }[],
      });
    } finally {
      await f.sql`delete from notification_digests where user_id=${member.userId}`;
      await f.sql`delete from contact_pairs
        where low_actor_id=${member.actorId} or high_actor_id=${member.actorId}`;
    }
  });

test('a burst of batched notifications is one digest, due a quiet time after the last', async () => {
  await withMember(async (env) => {
    await env.request(0);
    await env.request(5);
    const burst = await env.digests();
    await env.request(50);
    await env.request(58);
    const capped = await env.digests();
    assert({
      given: 'friend requests at minutes 0 and 5, then 50 and 58',
      should:
        'gather them into one digest due at minute 20, then held at the hour after the first',
      actual: {
        burst: burst.map(({ state, due, linked }) => [state, due, linked]),
        capped: capped.map(({ due, linked }) => [due, linked]),
      },
      expected: {
        burst: [['queued', minute(20), 2]],
        capped: [[minute(60), 4]],
      },
    });
  });
});

test('a digest lists only what is unread and still stands, and ends when nothing is', async () => {
  await withMember(async (env) => {
    await env.request(0);
    await env.request(1);
    const [digest] = await env.digests();
    const listed = async () => {
      const delivery = await env.notifications.readNotificationDigestDelivery(
        digest!.id,
      );
      return delivery.kind === 'send' ? delivery.items.length : delivery;
    };
    const both = await listed();
    const [first] = await env.f.sql`select id from notifications
      where user_id=${env.member.userId} order by surfaced_at limit 1`;
    await env.notifications.markNotificationsRead({
      userId: env.member.userId,
      notificationIds: [(first as { id: string }).id],
      at: minute(2),
    });
    const oneRead = await listed();
    // The other request is answered: it no longer stands.
    await env.f
      .sql`update friendships set state='accepted',accepted_at=requested_at
      where high_actor_id=${env.member.actorId} or low_actor_id=${env.member.actorId}`;
    assert({
      given: 'a digest of two requests, then one read, then the other answered',
      should: 'list two, then one, then cancel as owed nothing',
      actual: [both, oneRead, await listed()],
      expected: [2, 1, { kind: 'cancel', errorCode: 'not-owed' }],
    });
  });
});

test('a member who stopped all email is owed no digest', async () => {
  await withMember(async (env) => {
    await env.notifications.stopNotificationEmail({
      userId: env.member.userId,
    });
    await env.request(0);
    const presentation = await env.notifications.readNotificationPresentation({
      userId: env.member.userId,
    });
    assert({
      given: 'the master email switch off, then a friend request',
      should: 'keep the other choices and owe no digest',
      actual: { presentation, digests: (await env.digests()).length },
      expected: {
        presentation: {
          toasts: true,
          sound: true,
          desktopAlerts: true,
          email: false,
        },
        digests: 0,
      },
    });
  });
});

test('a digest postponed while its member is online waits again, or joins the next', async () => {
  await withMember(async (env) => {
    await env.request(0);
    const claim = async () => {
      await env.f
        .sql`update notification_digests set next_attempt_at=clock_timestamp()
        where user_id=${env.member.userId} and state='queued'`;
      const claims = await env.notifications.claimNotificationDigests({
        limit: 50,
        leaseMs: 60_000,
        maxAttempts: 8,
        nextToken: () => `${createId()}${createId()}`,
      });
      const mine = new Set((await env.digests()).map((d) => d.id));
      return claims.find((c) => mine.has(c.id))!;
    };
    const held = await claim();
    await env.notifications.postponeNotificationDigest({
      id: held.id,
      token: held.token,
      until: minute(30),
    });
    const waited = await env.f
      .sql`select state,attempts from notification_digests
      where id=${held.id}`;
    const again = await claim();
    // Owed while this one is held: a second digest is queued for the member.
    await env.request(31);
    await env.notifications.postponeNotificationDigest({
      id: again.id,
      token: again.token,
      until: minute(45),
    });
    assert({
      given:
        'a held digest postponed, then held again while another request queues a second',
      should:
        'go back to the queue unspent, then end and hand its notification to the queued one',
      actual: {
        waited: waited.map((row: { state: string; attempts: number }) => [
          row.state,
          row.attempts,
        ]),
        after: (await env.digests()).map(({ state, linked }) => [
          state,
          linked,
        ]),
      },
      expected: {
        waited: [['queued', 0]],
        after: [
          ['cancelled', 0],
          ['queued', 2],
        ],
      },
    });
  });
});
