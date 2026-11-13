import { createId } from '@paralleldrive/cuid2';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { withFixture } from './constraint-helpers';
import {
  databaseUrl,
  now,
  prepared,
  send,
  member,
  endRoom,
  cleanupRoomChat,
  refusal,
} from './room-community.test-support';
import { contentModerationOperations } from '../src/content-moderation-operations';
import { spectatorChatModeration } from '../src/messaging/spectator-chat';
import { roundFloorModeration } from '../src/messaging/round-floor-moderation';
import { roomCommunityModeration } from '../src/messaging/room-community-moderation';
import type { createRoomCommunityStore } from '../src/messaging/room-community-store';
import type { RoomCommunityScope } from '../src/messaging/room-community-contracts';
setupRitewayBun();
type Store = ReturnType<typeof createRoomCommunityStore>;
type Sent = Awaited<ReturnType<typeof send>>;
const removeOwn = (store: Store, scope: RoomCommunityScope, message: Sent) =>
  store.withChat({ ...scope, action: 'remove' }, async (frame) => {
    const state = await frame.readMutationState({
      version: 1,
      channelId: scope.channelId,
      requestId: createId(),
      messageId: message.id,
      kind: 'remove',
    });
    await frame.commitMutation({
      message: {
        ...message,
        text: null,
        removedAt: now,
        changeVersion: state.counters.changeVersion + 1,
      },
      payloadDigest: 'd'.repeat(64),
    });
  });
const textOf = async (
  f: { sql: (typeof import('bun'))['sql'] },
  messageId: string,
) =>
  (await f.sql`select text from messaging_messages where id=${messageId}`)[0]
    ?.text as string | null | undefined;
const operations = (
  db: Parameters<typeof contentModerationOperations>[0]['database'],
) =>
  contentModerationOperations({
    database: db,
    chat: spectatorChatModeration,
    floor: roundFloorModeration,
    roomChat: roomCommunityModeration,
  });

describe('Room chat reports and own withdrawal (RCHAT-8)', () => {
  test('atomic report and existing operator review/remove', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store, db } = await prepared(f);
      const commandId = createId();
      try {
        const visitor = await member(f);
        const message = await send(store, { ...scope, ...visitor });
        const id = createId();
        await store.readChat(scope, (frame) =>
          frame.fileReport({ id, messageId: message.id, reason: 'harassment' }),
        );
        await store.readChat(scope, (frame) =>
          frame.fileReport({
            id: createId(),
            messageId: message.id,
            reason: 'spam',
          }),
        );
        const ops = operations(db);
        const generic = await ops.readReportTargetFacts({
          reporterUserId: scope.userId,
          reporterActorId: scope.actorId,
          report: {
            targetKind: 'chat_message',
            targetId: message.id,
            reason: 'harassment',
          },
        });
        const detail = await ops.readModerationReport(id);
        const removal = await ops.runModerationCommand({
          commandId,
          serviceId: 'fixture',
          operatorRef: 'fixture',
          requestDigest: 'd'.repeat(64),
          adminAuditHead: 'a'.repeat(64),
          live: () => true,
          change: { action: 'chat_message.remove', messageId: message.id },
        });
        const history = await store.readChat(scope, (frame) =>
          frame.history({ limit: 10 }),
        );
        const [count] =
          await f.sql`select count(*)::int as n from content_reports where reporter_user_id=${scope.userId}`;
        assert({
          given: 'the host reporting a visitor’s Room chat message twice',
          should:
            'deduplicate atomically, remain absent from spectator report lookup and support signed operator review/removal',
          actual: {
            generic: generic.kind,
            subject: detail?.subject,
            count: count.n,
            removal,
            removed: history.messages[0]?.text,
          },
          expected: {
            generic: 'missing',
            subject: {
              kind: 'chat_message',
              messageId: message.id,
              text: 'Room chat',
              authorUserId: visitor.userId,
            },
            count: 1,
            removal: { v: 1, outcome: 'applied' },
            removed: null,
          },
        });
      } finally {
        await f.sql`delete from content_reports where reporter_user_id=${scope.userId}`;
        await f.sql`delete from operator_command_receipts where command_id=${commandId}`;
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  test('a report already filed stays reviewable after the Room ends, until its rows are due', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store, db } = await prepared(f);
      try {
        const visitor = await member(f);
        const message = await send(store, { ...scope, ...visitor });
        const id = createId();
        await store.readChat(scope, (frame) =>
          frame.fileReport({ id, messageId: message.id, reason: 'hate' }),
        );
        const ops = operations(db);
        await endRoom(f.sql, scope.roomId, 'started');
        const late = await refusal(() =>
          store.readChat(scope, (frame) =>
            frame.fileReport({
              id: createId(),
              messageId: message.id,
              reason: 'spam',
            }),
          ),
        );
        const retained = (await ops.readModerationReport(id))?.subject;
        await f.sql`update rooms set updated_at=clock_timestamp()-interval '181 days' where id=${scope.roomId}`;
        const expired = (await ops.readModerationReport(id))?.subject;
        assert({
          given:
            'a report filed while the Room was open, read by an operator after Start and again 181 days after',
          should:
            'refuse new reports once the Room ended, keep the filed one’s subject for the retention window and drop it after',
          actual: { late, retained: retained?.kind, expired: expired ?? null },
          expected: {
            late: 'AUTHORIZATION',
            retained: 'chat_message',
            expired: null,
          },
        });
      } finally {
        await f.sql`delete from content_reports where reporter_user_id=${scope.userId}`;
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  test('report refusal leaves reports unchanged', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f, { visibility: 'private' });
      try {
        const own = await send(store, scope);
        const outsider = await member(f);
        const attempt = (messageId: string) =>
          store.readChat(scope, (frame) =>
            frame.fileReport({ id: createId(), messageId, reason: 'spam' }),
          );
        const actual = [
          await refusal(() => attempt(own.id)),
          await refusal(() => attempt(createId())),
          await refusal(() =>
            store.readChat({ ...scope, ...outsider }, (frame) =>
              frame.fileReport({
                id: createId(),
                messageId: own.id,
                reason: 'spam',
              }),
            ),
          ),
        ];
        const [count] =
          await f.sql`select count(*)::int as n from content_reports where reporter_user_id in (${scope.userId},${outsider.userId})`;
        assert({
          given:
            'an own message, an unknown target, and a member who may not read the private Room',
          should:
            'refuse without creating a report or revealing target content',
          actual: { actual, count: count.n },
          expected: {
            actual: ['NOT_FOUND', 'NOT_FOUND', 'AUTHORIZATION'],
            count: 0,
          },
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  test('restricted own removal grants no peer history', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f);
      try {
        const message = await send(store, scope);
        await f.sql`insert into moderation_actions(id,user_id,kind,starts_at,operator_ref) values(${createId()},${scope.userId},'ban','2026-01-01','fixture')`;
        const own = await store.readChat(
          { ...scope, action: 'remove' },
          (frame) =>
            frame.readRequestState({
              requestId: createId(),
              messageId: message.id,
            }),
        );
        const history = await refusal(() =>
          store.readChat({ ...scope, action: 'remove' }, (frame) =>
            frame.history({ limit: 10 }),
          ),
        );
        const foreign = await refusal(() =>
          store.readChat({ ...scope, action: 'remove' }, (frame) =>
            frame.readRequestState({
              requestId: createId(),
              messageId: createId(),
            }),
          ),
        );
        await removeOwn(store, scope, message);
        assert({
          given: 'a restricted member removing their own Room chat message',
          should:
            'allow own withdrawal while denying general history and foreign-target preflight',
          actual: {
            own: own.message?.id === message.id,
            history,
            foreign,
            text: await textOf(f, message.id),
          },
          expected: {
            own: true,
            history: 'AUTHORIZATION',
            foreign: 'NOT_FOUND',
            text: null,
          },
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
  for (const status of ['started', 'closed'] as const)
    test(`own removal survives a ${status} Room and nothing else does (RCHAT-4)`, async () =>
      withFixture(databaseUrl, async (f) => {
        const { scope, store } = await prepared(f);
        try {
          const visitor = await member(f);
          const who = { ...scope, ...visitor };
          const message = await send(store, who);
          const peer = await send(store, scope);
          await endRoom(f.sql, scope.roomId, status);
          const edit = await refusal(() =>
            store.withChat({ ...who, action: 'remove' }, (frame) =>
              frame.readMutationState({
                version: 1,
                channelId: scope.channelId,
                requestId: createId(),
                messageId: message.id,
                kind: 'edit',
                text: 'Changed',
              }),
            ),
          );
          const post = await refusal(() =>
            send(store, { ...who, action: 'remove' } as typeof who),
          );
          const history = await refusal(() =>
            store.readChat({ ...who, action: 'remove' }, (frame) =>
              frame.history({ limit: 10 }),
            ),
          );
          const peerRemoval = await refusal(() => removeOwn(store, who, peer));
          await removeOwn(store, who, message);
          assert({
            given: `a visitor’s own message and the host’s in a Room that ${status}`,
            should:
              'allow the visitor to remove their own while closing edits, sends, history and anyone else’s message',
            actual: {
              edit,
              post,
              history,
              peerRemoval,
              own: await textOf(f, message.id),
              peer: await textOf(f, peer.id),
            },
            expected: {
              edit: 'AUTHORIZATION',
              post: 'AUTHORIZATION',
              history: 'AUTHORIZATION',
              peerRemoval: 'NOT_FOUND',
              own: null,
              peer: 'Room chat',
            },
          });
        } finally {
          await cleanupRoomChat(f, scope.roomId);
        }
      }));
  test('own removal outlives the right to read the Room, and ends with the retention window', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f);
      try {
        const visitor = await member(f);
        const who = { ...scope, ...visitor };
        const first = await send(store, who);
        const second = await send(store, who);
        await f.sql`update rooms set visibility='private',version=version+1 where id=${scope.roomId}`;
        const read = await refusal(() =>
          store.readChat(who, (frame) => frame.history({ limit: 10 })),
        );
        await removeOwn(store, who, first);
        await endRoom(
          f.sql,
          scope.roomId,
          'closed',
          '2026-05-15T23:59:59.000Z',
        );
        const expired = await refusal(() => removeOwn(store, who, second));
        assert({
          given:
            'a visitor’s messages in a Room made private, then the same Room 180 days after it closed',
          should:
            'still let the author remove their own without reading, and refuse once the rows are due to be purged',
          actual: {
            read,
            first: await textOf(f, first.id),
            expired,
            second: await textOf(f, second.id),
          },
          expected: {
            read: 'AUTHORIZATION',
            first: null,
            expired: 'AUTHORIZATION',
            second: 'Room chat',
          },
        });
      } finally {
        await cleanupRoomChat(f, scope.roomId);
      }
    }));
});
