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
} from './round-floor.test-support';
import { contentModerationOperations } from '../src/content-moderation-operations';
import { spectatorChatModeration } from '../src/messaging/spectator-chat';
import { roundFloorModeration } from '../src/messaging/round-floor-moderation';
import { admitParticipants } from '../src/beta-access-testing';
setupRitewayBun();
describe('private floor reports and own withdrawal', () => {
  test('atomic report and existing operator review/remove', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store, db } = await prepared(f);
      const commandId = createId();
      try {
        const other = await f.participant(scope.roundId, 'negative');
        const [account] =
          await f.sql`select user_id from actors where id=${other}`;
        const userId = String(account.user_id);
        await f.sql`update users set email_verified=true where id=${userId}`;
        const message = await send(store, { ...scope, actorId: other, userId });
        const id = createId();
        await store.readFloor(scope, (frame) =>
          frame.fileReport({ id, messageId: message.id, reason: 'harassment' }),
        );
        await store.readFloor(scope, (frame) =>
          frame.fileReport({
            id: createId(),
            messageId: message.id,
            reason: 'spam',
          }),
        );
        const ops = contentModerationOperations({
          database: db,
          chat: spectatorChatModeration,
          floor: roundFloorModeration,
        });
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
        const history = await store.readFloor(scope, (frame) =>
          frame.history({ limit: 10 }),
        );
        const [count] =
          await f.sql`select count(*)::int as n from content_reports where reporter_user_id=${scope.userId}`;
        assert({
          given: 'a current debater reporting a peer floor message twice',
          should:
            'deduplicate atomically, remain absent from spectator report lookup and support signed operator review/removal',
          actual: {
            generic: generic.kind,
            subject: detail?.subject?.kind,
            count: count.n,
            removal,
            removed: history.messages[0]?.text,
          },
          expected: {
            generic: 'missing',
            subject: 'chat_message',
            count: 1,
            removal: { v: 1, outcome: 'applied' },
            removed: null,
          },
        });
      } finally {
        await f.sql`delete from content_reports where reporter_user_id=${scope.userId}`;
        await f.sql`delete from operator_command_receipts where command_id=${commandId}`;
        await cleanupFloor(f, scope.roundId);
      }
    }));
  test('private report refusal leaves reports unchanged', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f);
      try {
        const own = await send(store, scope);
        const outsider = await f.actor();
        const [account] =
          await f.sql`select user_id from actors where id=${outsider}`;
        const userId = String(account.user_id);
        await admitParticipants(f.sql, [userId]);
        await f.sql`update users set email_verified=true where id=${userId}`;
        const attempt = (messageId: string) =>
          store.readFloor(scope, (frame) =>
            frame.fileReport({ id: createId(), messageId, reason: 'spam' }),
          );
        const actual = [
          await refusal(() => attempt(own.id)),
          await refusal(() => attempt(createId())),
          await refusal(() =>
            store.readFloor({ ...scope, actorId: outsider, userId }, (frame) =>
              frame.fileReport({
                id: createId(),
                messageId: own.id,
                reason: 'spam',
              }),
            ),
          ),
        ];
        const [count] =
          await f.sql`select count(*)::int as n from content_reports where reporter_user_id in (${scope.userId},${userId})`;
        assert({
          given: 'an own message, foreign target, or outsider report',
          should:
            'refuse without creating a report or revealing target content',
          actual: { actual, count: count.n },
          expected: {
            actual: ['NOT_FOUND', 'NOT_FOUND', 'AUTHORIZATION'],
            count: 0,
          },
        });
      } finally {
        await cleanupFloor(f, scope.roundId);
      }
    }));
  test('restricted own removal grants no peer history', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f);
      try {
        const message = await send(store, scope);
        await f.sql`insert into moderation_actions(id,user_id,kind,starts_at,operator_ref) values(${createId()},${scope.userId},'ban','2026-01-01','fixture')`;
        const own = await store.readFloor(
          { ...scope, action: 'remove' },
          (frame) =>
            frame.readRequestState({
              requestId: createId(),
              messageId: message.id,
            }),
        );
        const history = await refusal(() =>
          store.readFloor({ ...scope, action: 'remove' }, (frame) =>
            frame.history({ limit: 10 }),
          ),
        );
        const foreign = await refusal(() =>
          store.readFloor({ ...scope, action: 'remove' }, (frame) =>
            frame.readRequestState({
              requestId: createId(),
              messageId: createId(),
            }),
          ),
        );
        await store.withFloor({ ...scope, action: 'remove' }, async (frame) => {
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
        assert({
          given:
            'a restricted original audience member removing their own message',
          should:
            'allow own withdrawal while denying general history and foreign-target preflight',
          actual: { own: own.message?.id === message.id, history, foreign },
          expected: {
            own: true,
            history: 'AUTHORIZATION',
            foreign: 'NOT_FOUND',
          },
        });
      } finally {
        await cleanupFloor(f, scope.roundId);
      }
    }));
  test('retained own removal does not grant terminal posting or editing', async () =>
    withFixture(databaseUrl, async (f) => {
      const { scope, store } = await prepared(f);
      try {
        const message = await send(store, scope);
        await f.sql`update rounds set status='abandoned',completed_at=${now}::timestamptz,version=version+1 where id=${scope.roundId}`;
        const edit = await refusal(() =>
          store.withFloor({ ...scope, action: 'remove' }, (frame) =>
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
          send(store, { ...scope, action: 'remove' } as typeof scope),
        );
        await store.withFloor({ ...scope, action: 'remove' }, async (frame) => {
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
        const history = await store.readFloor(scope, (frame) =>
          frame.history({ limit: 10 }),
        );
        assert({
          given: 'the original author in retained terminal floor history',
          should:
            'allow own removal while closing edits and sends including under removal mode',
          actual: { edit, post, removed: history.messages[0]?.text },
          expected: {
            edit: 'AUTHORIZATION',
            post: 'AUTHORIZATION',
            removed: null,
          },
        });
      } finally {
        await cleanupFloor(f, scope.roundId);
      }
    }));
});
