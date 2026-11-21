import { expect, test } from 'bun:test';
import type { SavepointSQL, TransactionSQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { buildUserInboxTopic } from '@daisy/protocol';
import { holdForGuardian } from '../src/friends/hold-for-guardian';
import { notificationDigestOperations } from '../src/notifications/digests';
import { notificationInboxOperations } from '../src/notifications/inbox';
import { oweNotifications } from '../src/notifications/owe';
import { scopeTransaction } from '../src/tenant-scope';
import { withRolledBackDatabase } from '../src/testing-rolled-back';

const { databaseUrl } = requireTestServices(process.env);
const day = 24 * 60 * 60 * 1000;
const at = new Date();

async function member(sql: TransactionSQL, years: number) {
  const userId = createId();
  const actorId = createId();
  await sql`insert into users(id,username,email,email_verified) values
    (${userId},${userId},${`${userId}@daisy.test`},true)`;
  await sql`insert into actors(id,kind,user_id) values (${actorId},'human',${userId})`;
  await sql`insert into account_age(user_id,birth_month,version,recorded_at)
    values (${userId},to_char(statement_timestamp() - ${years} * interval '1 year','YYYY-MM'),1,statement_timestamp() - interval '100 days')`;
  return { userId, actorId };
}

async function seed(sql: TransactionSQL) {
  const guardian = await member(sql, 40);
  const child = await member(sql, 15);
  const consentId = createId();
  await sql`insert into guardian_consent_evidence(id,person_user_id,role,method,notice_kind,notice_version,notice_digest,recorded_at)
    values(${consentId},${guardian.userId},'guardian','created-account','parental-consent','fixture',${'a'.repeat(64)},${at})`;
  await sql`insert into guardian_links(id,guardian_user_id,minor_user_id,guardian_consent_id,status,activation,activated_at,created_at)
    values(${createId()},${guardian.userId},${child.userId},${consentId},'active','created-account',${at},${at})`;
  const request = async (ageDays: number) => {
    const sender = await member(sql, 35);
    const [lowActorId, highActorId] = [sender.actorId, child.actorId].sort();
    const pair = { lowActorId: lowActorId!, highActorId: highActorId! };
    const requestedAt = new Date(at.getTime() - ageDays * day);
    await sql`insert into contact_pairs(low_actor_id,high_actor_id)
      values(${pair.lowActorId},${pair.highActorId})`;
    await sql`insert into friendships(low_actor_id,high_actor_id,requester_actor_id,state,requested_at)
      values(${pair.lowActorId},${pair.highActorId},${sender.actorId},'pending',${requestedAt})`;
    return { sender, pair, requestedAt };
  };
  return {
    guardian,
    child,
    recent: await request(0),
    expired: await request(92),
  };
}

test('guardian delivery and retention enforce private role boundaries and a held digest stops standing', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed,
    work: (db, { child, guardian, recent, expired }, sql) =>
      db.transaction(async (database) => {
        const inbox = notificationInboxOperations({ database });
        const digest = notificationDigestOperations({ database });
        const scoped = async <T>(
          subject: string,
          work: (sp: SavepointSQL) => Promise<T>,
        ) =>
          sql.savepoint(async (sp) => {
            await sp`select set_config('daisy.subject_scope', ${subject}, true)`;
            const result = await work(sp);
            await sp`select set_config('daisy.subject_scope', '', true)`;
            return result;
          });
        expect<unknown>(await sql`select current_user as role`).toEqual([
          { role: 'daisy_web' },
        ]);
        await db.transaction((tx) =>
          oweNotifications(tx, {
            kind: 'friend_request_received',
            subject: {
              friendship_low_actor_id: recent.pair.lowActorId,
              friendship_high_actor_id: recent.pair.highActorId,
            },
            recipients: [
              { userId: child.userId, about: recent.sender.actorId },
            ],
            at: recent.requestedAt.toISOString(),
            nextId: createId,
          }),
        );
        const [pending] = await sql`select digest_id from notifications
        where user_id=${child.userId} and kind='friend_request_received'`;
        expect(typeof pending?.digest_id).toBe('string');
        expect(
          await digest.readNotificationDigestDelivery(pending!.digest_id),
        ).toMatchObject({
          kind: 'send',
          userId: child.userId,
          items: [{ kind: 'friend_request_received' }],
        });

        for (const request of [recent, expired])
          await db.transaction(async (tx) => {
            await scopeTransaction(tx, {
              subjectUserId: request.sender.userId,
            });
            await holdForGuardian(tx, {
              childActorId: child.actorId,
              pair: request.pair,
              at: request.requestedAt.toISOString(),
              nextId: createId,
            });
            await scopeTransaction(tx, {});
          });
        expect(
          await digest.readNotificationDigestDelivery(pending!.digest_id),
        ).toEqual({ kind: 'cancel', errorCode: 'not-owed' });
        expect<unknown>(
          await sql`select user_id from notification_digests
        where user_id=${guardian.userId}`,
        ).toEqual([]);

        const listGuardian = () =>
          inbox.readNotifications({
            userId: guardian.userId,
            limit: 10,
            unreadOnly: false,
            now: at.toISOString(),
            after: null,
          });
        const notices = (await listGuardian()).rows;
        expect(notices.map((row) => row.kind)).toEqual([
          'friend_guardian_approval',
          'friend_guardian_approval',
        ]);
        const topic = buildUserInboxTopic(guardian.actorId);
        const signalRows = (
          sp: SavepointSQL,
        ) => sp`select payload->>'notificationType' as kind,
        payload->'ids'->>0 as id from outbox where topic=${topic}
        and kind='user.notification-delivered' order by payload->'ids'->>0`;
        expect<unknown>(await scoped(recent.sender.userId, signalRows)).toEqual(
          [],
        );
        expect<unknown>(await scoped(guardian.userId, signalRows)).toEqual([]);
        expect<unknown>(
          await sql.savepoint(async (sp) => {
            await sp`set local role daisy_realtime`;
            const delivery = await signalRows(sp);
            await sp`set local role daisy_web`;
            return delivery;
          }),
        ).toEqual(
          notices
            .map((row) => ({ kind: row.kind, id: row.id }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        );
        const [recentNotice, expiredNotice] = notices;
        await inbox.markNotificationsRead({
          userId: guardian.userId,
          notificationIds: [recentNotice!.id],
          at: at.toISOString(),
        });
        await inbox.markNotificationsRead({
          userId: guardian.userId,
          notificationIds: [expiredNotice!.id],
          at: new Date(at.getTime() - 91 * day).toISOString(),
        });
        await sql`select set_config('daisy.subject_scope', '', true)`;
        expect<unknown>(
          await sql`delete from notifications where id=${expiredNotice!.id} returning id`,
        ).toEqual([]);
        expect(
          await inbox.purgeReadNotifications({
            before: new Date(at.getTime() + day).toISOString(),
            limit: 10,
          }),
        ).toBe(1);
        expect((await listGuardian()).rows.map((row) => row.id)).toEqual([
          recentNotice!.id,
        ]);
      }),
  });
});
