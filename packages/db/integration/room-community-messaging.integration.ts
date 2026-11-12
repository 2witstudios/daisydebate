import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  databaseUrl,
  now,
  prepared,
  send,
  seat,
  member,
  endRoom,
  cleanupRoomChat,
  refusal,
  waitForBlockedBy,
} from './room-community.test-support';
import { channelObservationReads } from '../src/messaging/observation-reads';
import { createRoomCommunityChannelCohortAuthority } from '../src/messaging/room-community-observation';
import { createMessagingPrivacyAdopter } from '../src/messaging/privacy';
setupRitewayBun();
describe('Room chat Messaging producer', () => {
  test('creation, retries, ordering and paginated history (RCHAT-6)', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope, db } = await prepared(f);
      try {
        await cleanupRoomChat(f, scope.roomId);
        const absent = await store.discover(scope);
        const afterDiscovery = await f.count(
          'messaging_channels',
          'room_id',
          scope.roomId,
        );
        const reopened = await Promise.all([
          store.open({ ...scope, newChannelId: createId() }),
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
        const before = await store.readChat(scope, (frame) =>
          frame.history({ limit: 1 }),
        );
        const older = await store.readChat(scope, (frame) =>
          frame.history({ limit: 1, before: before.nextBefore!.sequence }),
        );
        const mark = await store.readChat(scope, (frame) => frame.markRead(2));
        const conflict = await refusal(() =>
          send(store, scope, requestId, 'Changed retry'),
        );
        const headers = await channelObservationReads(
          db,
        ).readChannelObservationHeaders([scope.channelId]);
        const fact = await store.readChat(scope, async (frame) => frame.fact);
        assert({
          given:
            'a discovery before any open, then concurrent opens and equal and conflicting retries',
          should:
            'create nothing on discovery, keep one channel and one result per request in durable order, and carry the Room’s revision in the header',
          actual: {
            absent,
            afterDiscovery,
            channels: reopened.map((x) => x.channelId),
            rows: await f.count('messaging_channels', 'room_id', scope.roomId),
            metadata: reopened[0],
            same: first.id === retry.id,
            newest: before.messages[0]?.sequence,
            older: older.messages[0]?.sequence,
            mark,
            conflict,
            header:
              headers.get(scope.channelId)?.disclosureRevision ===
              fact.revision,
          },
          expected: {
            absent: null,
            afterDiscovery: 0,
            channels: [scope.channelId, scope.channelId, scope.channelId],
            rows: 1,
            metadata: {
              channelId: scope.channelId,
              readOnly: false,
              expiresAt: null,
            },
            same: true,
            newest: 2,
            older: 1,
            mark: 2,
            conflict: 'CONFLICT',
            header: true,
          },
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  for (const visibility of ['public', 'unlisted', 'private'] as const)
    test(`the audience of a ${visibility} Room (RCHAT-3)`, async () =>
      withFixture(databaseUrl, async (f) => {
        const { store, scope } = await prepared(f, { visibility });
        try {
          const debater = await member(f);
          const judge = await member(f);
          const visitor = await member(f);
          await seat(f, scope.roomId, debater.actorId, 'affirmative');
          await seat(f, scope.roomId, judge.actorId, 'judge');
          const facts = await Promise.all(
            [scope, debater, judge, visitor].map((who) =>
              refusal(() =>
                store.readChat({ ...scope, ...who }, async (frame) => {
                  if (
                    Object.keys(frame.fact).sort().join() !==
                    'actorId,channelId,endedAt,kind,policyKey,policyRevision,revision,roomId,standing,status,visibility'
                  )
                    throw new Error('The fact carries more than its contract');
                  return frame.fact.standing;
                }),
              ),
            ),
          );
          const posts = await Promise.all(
            [scope, debater, judge, visitor].map((who) =>
              refusal(() => send(store, { ...scope, ...who })),
            ),
          );
          const reads = await Promise.all(
            [scope, debater, judge, visitor].map((who) =>
              refusal(() =>
                store.readChat({ ...scope, ...who }, (frame) =>
                  frame.history({ limit: 10 }),
                ),
              ),
            ),
          );
          const admitted = visibility === 'private' ? 'AUTHORIZATION' : null;
          assert({
            given: `the host, a debater seat, a judge seat and a member with no seat in a ${visibility} Room`,
            should:
              visibility === 'private'
                ? 'admit the host and both seats and refuse the member with no seat'
                : 'admit all four, the seatless member as a visitor',
            actual: {
              facts,
              posts,
              reads,
              messages: await f.count(
                'messaging_messages',
                'channel_id',
                scope.channelId,
              ),
            },
            expected: {
              facts: [null, null, null, admitted],
              posts: [null, null, null, admitted],
              reads: [null, null, null, admitted],
              messages: visibility === 'private' ? 3 : 4,
            },
          });
        } finally {
          await cleanupRoomChat(f, scope.roomId);
        }
      }));
  test('a judge seat is not told apart from any other seat', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f);
      try {
        const judge = await member(f);
        const visitor = await member(f);
        await seat(f, scope.roomId, judge.actorId, 'judge');
        const standing = (who: { userId: string; actorId: string }) =>
          store.readChat(
            { ...scope, ...who },
            async (frame) => frame.fact.standing,
          );
        assert({
          given: 'the host, a judge seat and a visitor',
          should:
            'give the fact only seated or visitor, with nothing naming the judge',
          actual: [
            await standing(scope),
            await standing(judge),
            await standing(visitor),
          ],
          expected: ['seated', 'seated', 'visitor'],
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  test('foreign Room, mismatched account and unadmitted account (RCHAT-5)', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f);
      try {
        const other = await member(f);
        const otherRoom = await f.room(other.actorId, await f.format());
        const unadmitted = await f.actor();
        const [u] =
          await f.sql`select user_id from actors where id=${unadmitted}`;
        const noAge = await member(f);
        await f.sql`delete from account_age where user_id=${noAge.userId}`;
        const cases = [
          { ...scope, roomId: otherRoom },
          { ...scope, userId: other.userId },
          { ...scope, actorId: unadmitted, userId: String(u.user_id) },
          { ...scope, ...noAge },
        ];
        const posts = await Promise.all(
          cases.map((s) => refusal(() => send(store, s))),
        );
        const reads = await Promise.all(
          cases.map((s) =>
            refusal(() =>
              store.readChat(s, (frame) => frame.history({ limit: 10 })),
            ),
          ),
        );
        assert({
          given:
            'this channel under another Room, a principal that does not match the account, an unapproved account and one with no age record',
          should: 'refuse every read and post and add no content',
          actual: {
            posts,
            reads,
            count: await f.count(
              'messaging_messages',
              'channel_id',
              scope.channelId,
            ),
          },
          expected: {
            posts: [
              'NOT_FOUND',
              'AUTHORIZATION',
              'AUTHORIZATION',
              'AUTHORIZATION',
            ],
            reads: [
              'NOT_FOUND',
              'AUTHORIZATION',
              'AUTHORIZATION',
              'AUTHORIZATION',
            ],
            count: 0,
          },
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  test('an account with no authority cannot discover or open, and nothing is created', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f, { visibility: 'private' });
      try {
        await cleanupRoomChat(f, scope.roomId);
        const outsider = await member(f);
        const who = { roomId: scope.roomId, ...outsider };
        assert({
          given:
            'a member who may not read a private Room that has no chat yet',
          should:
            'refuse discovery and open and leave the Room without a channel',
          actual: [
            await refusal(() => store.discover(who)),
            await refusal(() =>
              store.open({ ...who, newChannelId: createId() }),
            ),
            await refusal(() => store.discover({ ...who, roomId: createId() })),
            await f.count('messaging_channels', 'room_id', scope.roomId),
          ],
          expected: ['AUTHORIZATION', 'AUTHORIZATION', 'NOT_FOUND', 0],
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  for (const status of ['started', 'closed'] as const)
    test(`the Room being ${status} races the send fence (RCHAT-4)`, async () =>
      withFixture(databaseUrl, async (f) => {
        const { store, scope, db } = await prepared(f);
        const visitor = await member(f);
        const blocker = new SQL(databaseUrl, { max: 1 });
        try {
          await send(store, scope);
          await blocker.unsafe('BEGIN');
          await endRoom(blocker, scope.roomId, status);
          const sending = refusal(() => send(store, scope));
          await waitForBlockedBy(f, blocker);
          await blocker.unsafe('COMMIT');
          const denied = await sending;
          const everyone = [scope, { ...scope, ...visitor }];
          const reads = await Promise.all(
            everyone.map((who) =>
              refusal(() =>
                store.readChat(who, (frame) => frame.history({ limit: 10 })),
              ),
            ),
          );
          const discoveries = await Promise.all(
            everyone.map((who) => refusal(() => store.discover(who))),
          );
          const reads$ = channelObservationReads(db);
          assert({
            given: `a Room ${status} while a sender waits on the Room lock`,
            should:
              'deny the send after the wait, deny read and discovery to host and visitor at once, and hide the channel from observation',
            actual: {
              denied,
              reads,
              discoveries,
              window: await reads$.readChannelObservationWindow(
                scope.channelId,
                10,
              ),
              header:
                (
                  await reads$.readChannelObservationHeaders([scope.channelId])
                ).get(scope.channelId) ?? null,
              messages: await f.count(
                'messaging_messages',
                'channel_id',
                scope.channelId,
              ),
            },
            expected: {
              denied: 'AUTHORIZATION',
              reads: ['AUTHORIZATION', 'AUTHORIZATION'],
              discoveries: ['AUTHORIZATION', 'AUTHORIZATION'],
              window: null,
              header: null,
              messages: 1,
            },
          });
        } finally {
          await blocker.unsafe('ROLLBACK');
          await blocker.close();
          await cleanupRoomChat(f, scope.roomId);
        }
      }));
  test('losing the right to read the Room ends the chat for that member', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f);
      try {
        const visitor = await member(f);
        const who = { ...scope, ...visitor };
        const before = await refusal(() => send(store, who));
        const revision = await store.readChat(
          scope,
          async (frame) => frame.fact.revision,
        );
        await f.sql`update rooms set visibility='private',version=version+1 where id=${scope.roomId}`;
        assert({
          given: 'a visitor who posted, then the Room made private',
          should:
            'refuse the visitor’s read and post, keep the host’s, and move the disclosure revision',
          actual: [
            before,
            await refusal(() => send(store, who)),
            await refusal(() =>
              store.readChat(who, (frame) => frame.history({ limit: 10 })),
            ),
            await refusal(() => send(store, scope)),
            (await store.readChat(
              scope,
              async (frame) => frame.fact.revision,
            )) > revision,
          ],
          expected: [null, 'AUTHORIZATION', 'AUTHORIZATION', null, true],
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  for (const change of ['restricted', 'erased'] as const)
    test(`account ${change} races the send fence (RCHAT-5)`, async () =>
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
              read: await refusal(() =>
                store.readChat(scope, (frame) => frame.history({ limit: 1 })),
              ),
              count: await f.count(
                'messaging_messages',
                'channel_id',
                scope.channelId,
              ),
            },
            expected: {
              denied: 'AUTHORIZATION',
              read: 'AUTHORIZATION',
              count: 0,
            },
          });
        } finally {
          await blocker.unsafe('ROLLBACK');
          await blocker.close();
          await cleanupRoomChat(f, scope.roomId);
        }
      }));
  test('author labels are usernames of visible authors only', async () =>
    withFixture(databaseUrl, async (f) => {
      const { store, scope } = await prepared(f);
      try {
        const visitor = await member(f);
        const silent = await member(f);
        const mine = await send(store, scope);
        const theirs = await send(store, { ...scope, ...visitor });
        const [host] =
          await f.sql`select username from users where id=${scope.userId}`;
        const [guest] =
          await f.sql`select username from users where id=${visitor.userId}`;
        const authors = await store.readChat(scope, (frame) =>
          frame.readAuthors([
            mine.authorActorId,
            theirs.authorActorId,
            silent.actorId,
          ]),
        );
        assert({
          given:
            'a page naming two authors of visible messages and a member who never posted',
          should:
            'label the two authors by username alone and say nothing of the third',
          actual: [...authors].sort((a, b) =>
            a.actorId.localeCompare(b.actorId),
          ),
          expected: [
            { actorId: scope.actorId, label: String(host.username) },
            { actorId: visitor.actorId, label: String(guest.username) },
          ].sort((a, b) => a.actorId.localeCompare(b.actorId)),
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  test('realtime-role cohort shares current Room authority (RCHAT-7)', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f);
      const visitor = await member(f);
      const client = new SQL(databaseUrl, { max: 1 });
      try {
        const revision = await store.readChat(
          scope,
          async (frame) => frame.fact.revision,
        );
        await client.unsafe('set role daisy_realtime');
        const db = drizzle({ client });
        const cohort = createRoomCommunityChannelCohortAuthority(db);
        const viewers = [scope, visitor];
        const open = await cohort(
          { channelId: scope.channelId, viewers },
          async (frame) => ({
            standings: viewers.map(
              (viewer) => frame.factFor(viewer.actorId).standing,
            ),
            revision: frame.factFor(scope.actorId).revision === revision,
            content: frame.contentRevision,
          }),
        );
        await client.unsafe('reset role');
        await endRoom(f.sql, scope.roomId, 'started');
        await client.unsafe('set role daisy_realtime');
        const ended = await refusal(() =>
          cohort({ channelId: scope.channelId, viewers }, async () => 'read'),
        );
        const foreign = await refusal(() =>
          cohort({ channelId: createId(), viewers }, async () => 'read'),
        );
        assert({
          given:
            'the actual realtime role with no message table grant, before and after the Room starts',
          should:
            'read the cohort’s standings and matching disclosure header through narrow functions, then find nothing to observe',
          actual: { open, ended, foreign },
          expected: {
            open: {
              standings: ['seated', 'visitor'],
              revision: true,
              content: 1,
            },
            ended: 'NOT_FOUND',
            foreign: 'NOT_FOUND',
          },
        });
      } finally {
        await client.unsafe('reset role');
        await client.close();
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
});

test('Room chat subject export and erasure preserve another member’s contribution', async () =>
  withFixture(databaseUrl, async (f) => {
    const { store, scope, db } = await prepared(f);
    try {
      const peer = await member(f);
      await send(store, scope, createId(), 'Export my Room chat message');
      await send(
        store,
        { ...scope, ...peer },
        createId(),
        'Keep the visitor contribution',
      );
      await store.readChat(scope, (frame) => frame.markRead(2));
      const adopter = createMessagingPrivacyAdopter();
      const subject = { userId: scope.userId, actorId: scope.actorId };
      const exported = await db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from users where id=${scope.userId} for update`,
        );
        return adopter.export(tx, subject);
      });
      await db.transaction(async (tx) => {
        await tx.execute(
          sql`select id from users where id=${scope.userId} for update`,
        );
        await adopter.erase(tx, subject, { now });
      });
      const rows =
        await f.sql`select text from messaging_messages where channel_id=${scope.channelId} order by sequence`;
      const [purge] =
        await f.sql`select status from observation_purge_jobs where user_id=${scope.userId}`;
      assert({
        given:
          'a host and a visitor contributing to one Room chat, then the host’s ordinary export and erasure',
        should:
          'export only the subject’s content, scrub it, drop their receipts and read state, queue the observation purge and keep the other member’s text',
        actual: {
          exported: exported.messaging_messages?.map((row) => row.text),
          leaked: JSON.stringify(exported).includes(
            'Keep the visitor contribution',
          ),
          texts: rows.map((row: { text: string | null }) => row.text),
          receipts: (
            await f.sql`select count(*)::int as n from messaging_receipts where channel_id=${scope.channelId} and actor_id=${scope.actorId}`
          )[0].n,
          states: (
            await f.sql`select count(*)::int as n from messaging_actor_states where channel_id=${scope.channelId} and actor_id=${scope.actorId}`
          )[0].n,
          purge: purge.status,
        },
        expected: {
          exported: ['Export my Room chat message'],
          leaked: false,
          texts: [null, 'Keep the visitor contribution'],
          receipts: 0,
          states: 0,
          purge: 'pending',
        },
      });
    } finally {
      await f.sql`delete from observation_purge_jobs where user_id=${scope.userId}`;
      await cleanupRoomChat(f, scope.roomId);
    }
  }));
