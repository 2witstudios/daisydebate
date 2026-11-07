import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  databaseUrl,
  now,
  prepared,
  send,
  cleanupFloor,
  refusal,
  waitForBlockedBy,
} from './round-floor.test-support';
import { roundFloorRetention } from '../src/messaging/round-floor-retention';
import { channelObservationReads } from '../src/messaging/observation-reads';
import { createRoundFloorChannelCohortAuthority } from '../src/messaging/round-floor-observation';
import { createMessagingPrivacyAdopter } from '../src/messaging/privacy';
import { admitParticipants } from '../src/beta-access-testing';
setupRitewayBun();
describe('Round floor Messaging producer', () => {
  test('creation, retries, ordering and private paginated history', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope, db } = await prepared(f);
      try {
        await cleanupFloor(f, scope.roundId);
        const reopened = await Promise.all([
          store.open({ ...scope, newChannelId: createId() }),
          store.open({ ...scope, newChannelId: createId() }),
        ]);
        scope.channelId = reopened[0]!.channelId;
        const requestId = createId();
        const [first, retry] = await Promise.all([
          send(store, scope, requestId),
          send(store, scope, requestId),
        ]);
        await send(store, scope);
        const before = await store.readFloor(scope, (frame) =>
          frame.history({ limit: 1 }),
        );
        const older = await store.readFloor(scope, (frame) =>
          frame.history({ limit: 1, before: before.nextBefore!.sequence }),
        );
        const mark = await store.readFloor(scope, (frame) => frame.markRead(2));
        const conflict = await refusal(() =>
          send(store, scope, requestId, 'Changed retry'),
        );
        const headers = await channelObservationReads(
          db,
        ).readChannelObservationHeaders([scope.channelId]);
        assert({
          given: 'concurrent channel opens and equal and conflicting retries',
          should:
            'keep one channel and one result per request with independent durable stream order',
          actual: {
            channels: reopened.map((x) => x.channelId),
            same: first.id === retry.id,
            newest: before.messages[0]?.sequence,
            older: older.messages[0]?.sequence,
            mark,
            conflict,
            header: headers.get(scope.channelId)?.disclosureRevision,
          },
          expected: {
            channels: [scope.channelId, scope.channelId],
            same: true,
            newest: 2,
            older: 1,
            mark: 2,
            conflict: 'CONFLICT',
            header: 2,
          },
        });
      } finally {
        await cleanupFloor(f, scope.roundId);
      }
    }));
  test('foreign, judge, hidden host judge and outsider denial is unchanged', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f);
      try {
        const judge = await f.participant(scope.roundId, 'judge');
        const outsider = await f.actor();
        const [j] = await f.sql`select user_id from actors where id=${judge}`;
        const [o] =
          await f.sql`select user_id from actors where id=${outsider}`;
        await admitParticipants(f.sql, [String(o.user_id)]);
        await f.sql`update rounds set created_by_actor_id=${judge} where id=${scope.roundId}`;
        const otherRound = await f.round();
        const actual = await Promise.all(
          [
            { ...scope, actorId: judge, userId: String(j.user_id) },
            { ...scope, actorId: outsider, userId: String(o.user_id) },
            { ...scope, roundId: otherRound },
            { ...scope, userId: String(j.user_id) },
          ].map((s) => refusal(() => send(store, s))),
        );
        const [count] =
          await f.sql`select count(*)::int as n from messaging_messages where channel_id=${scope.channelId}`;
        assert({
          given:
            'a hidden host judge, outsider, foreign Round or mismatched account',
          should: 'refuse every read and post grant without adding content',
          actual: { actual, count: count.n },
          expected: {
            actual: [
              'AUTHORIZATION',
              'AUTHORIZATION',
              'AUTHORIZATION',
              'AUTHORIZATION',
            ],
            count: 0,
          },
        });
      } finally {
        await cleanupFloor(f, scope.roundId);
      }
    }));
  test('Round ending races the send fence', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f);
      const blocker = new SQL(databaseUrl, { max: 1 });
      try {
        await blocker.unsafe('BEGIN');
        await blocker`update rounds set status='abandoned',completed_at=${now}::timestamptz,version=version+1 where id=${scope.roundId}`;
        const sending = refusal(() => send(store, scope));
        await waitForBlockedBy(f, blocker);
        await blocker.unsafe('COMMIT');
        const denied = await sending;
        const retained = await store.discover(scope);
        assert({
          given:
            'terminal transition commits while a floor sender waits on the Round',
          should:
            'deny the send after the wait and retain read-only history for the original audience',
          actual: {
            denied,
            readOnly: retained?.readOnly,
            messages: (
              await store.readFloor(scope, (x) => x.history({ limit: 10 }))
            ).messages.length,
          },
          expected: { denied: 'AUTHORIZATION', readOnly: true, messages: 0 },
        });
      } finally {
        await blocker.unsafe('ROLLBACK');
        await blocker.close();
        await cleanupFloor(f, scope.roundId);
      }
    }));
  for (const change of ['restricted', 'erased'] as const)
    test(`account ${change} races the send fence`, async () =>
      withFixture(databaseUrl, async (f) => {
        const { store, scope } = await prepared(f);
        const blocker = new SQL(databaseUrl, { max: 1 });
        try {
          await blocker.unsafe('BEGIN');
          await blocker`select id from users where id=${scope.userId} for update`;
          if (change === 'restricted')
            await blocker`insert into moderation_actions(id,user_id,kind,starts_at,operator_ref) values(${createId()},${scope.userId},'ban','2026-01-01','fixture')`;
          else
            await blocker`update users set deleted_at=${now}::timestamptz where id=${scope.userId}`;
          const sending = refusal(() => send(store, scope));
          await waitForBlockedBy(f, blocker);
          await blocker.unsafe('COMMIT');
          const denied = await sending;
          assert({
            given: `a current account ${change} before the sender's account fence completes`,
            should: 'deny the sender and preserve empty stream state',
            actual: {
              denied,
              count: await f.count(
                'messaging_messages',
                'channel_id',
                scope.channelId,
              ),
            },
            expected: { denied: 'AUTHORIZATION', count: 0 },
          });
        } finally {
          await blocker.unsafe('ROLLBACK');
          await blocker.close();
          await cleanupFloor(f, scope.roundId);
        }
      }));
  test('privacy scrub and end-based bounded retention', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope, db } = await prepared(f);
      try {
        await send(store, scope);
        await store.readFloor(scope, (x) => x.markRead(1));
        await db.transaction(async (tx) => {
          await tx.execute(
            (await import('drizzle-orm'))
              .sql`select id from users where id=${scope.userId} for update`,
          );
          await createMessagingPrivacyAdopter().erase(
            tx,
            { userId: scope.userId, actorId: scope.actorId },
            { now },
          );
        });
        const [scrub] =
          await f.sql`select text from messaging_messages where channel_id=${scope.channelId}`;
        const [purge] =
          await f.sql`select status from observation_purge_jobs where user_id=${scope.userId}`;
        await f.sql`update rounds set status='abandoned',completed_at='2026-01-01',version=version+1 where id=${scope.roundId}`;
        const denied = await refusal(() => store.discover(scope));
        const hidden = await channelObservationReads(
          db,
        ).readChannelObservationWindow(scope.channelId, 10);
        const retention = roundFloorRetention(db);
        await retention.purgeExpiredRoundFloorMessages({
          before: '2026-05-11T00:00:00.000Z',
          limit: 1,
        });
        const remaining = await f.count(
          'messaging_messages',
          'channel_id',
          scope.channelId,
        );
        await retention.purgeExpiredRoundFloorMessages({
          before: '2026-06-01T00:00:00.000Z',
          limit: 1,
        });
        await retention.purgeExpiredRoundFloorReceipts({
          before: '2026-06-01T00:00:00.000Z',
          limit: 1,
        });
        await retention.purgeExpiredRoundFloorReadStates({
          before: '2026-06-01T00:00:00.000Z',
          limit: 1,
        });
        assert({
          given:
            'authored floor content erased in the ordinary Messaging privacy transaction, then an expired terminal floor',
          should:
            'scrub content, queue its observation purge, deny stale history even before sweeping and retain only counters',
          actual: {
            text: scrub.text,
            purge: purge.status,
            denied,
            hidden,
            remaining,
            counters: await f.count(
              'messaging_channel_streams',
              'channel_id',
              scope.channelId,
            ),
          },
          expected: {
            text: null,
            purge: 'pending',
            denied: 'AUTHORIZATION',
            hidden: null,
            remaining: 0,
            counters: 1,
          },
        });
      } finally {
        await f.sql`delete from observation_purge_jobs where user_id=${scope.userId}`;
        await cleanupFloor(f, scope.roundId);
      }
    }));
  test('realtime-role cohort shares current floor authority', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope } = await prepared(f);
      const client = new SQL(databaseUrl, { max: 1 });
      try {
        await client.unsafe('set role daisy_realtime');
        const db = drizzle({ client });
        const result = await createRoundFloorChannelCohortAuthority(db)(
          { channelId: scope.channelId, viewers: [scope] },
          async (frame) => ({
            fact: frame.factFor(scope.actorId).audience,
            revision: frame.factFor(scope.actorId).revision,
            content: frame.contentRevision,
          }),
        );
        assert({
          given: 'the actual realtime role with no message table grant',
          should:
            'obtain the named floor cohort and matching disclosure header through narrow functions',
          actual: result,
          expected: { fact: 'debater', revision: 2, content: 1 },
        });
      } finally {
        await client.unsafe('reset role');
        await client.close();
        await cleanupFloor(f, scope.roundId);
      }
    }));
});
