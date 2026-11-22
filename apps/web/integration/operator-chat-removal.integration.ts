import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { createAppError } from '@daisy/errors';
import { api, signed } from '../src/features/operator-api/router.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { launchRuntimeRound } from './round-runtime.test-support';

setupRitewayBun();

test('signed chat removal stops at the first found owner, replays and rolls back atomically', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const { roundId } = await launchRuntimeRound(f, room);
    const commands: string[] = [],
      channels: string[] = [];
    try {
      for (const [index, kind] of [
        'round_spectator',
        'round_floor',
        'room_community',
      ].entries()) {
        const channelId = createId(),
          messageId = createId();
        channels.push(channelId);
        await f.sql`insert into messaging_channels(id,kind,policy_key,policy_revision,lifecycle,round_id,room_id)
          values(${channelId},${kind},${kind === 'round_spectator' ? 'round.spectator' : kind === 'round_floor' ? 'round.floor' : 'room.community'},1,'active',${kind === 'room_community' ? null : roundId},${kind === 'room_community' ? room.id : null})`;
        await f.sql`insert into messaging_channel_streams(channel_id,message_sequence,change_version) values(${channelId},1,2)`;
        await f.sql`insert into messaging_messages(id,channel_id,author_actor_id,sequence,change_version,text,created_at) values(${messageId},${channelId},${f.host.actorId},1,2,'Original message',now())`;
        const calls: string[] = [];
        let fail = true,
          expired = false;
        const retained: { remove?: () => Promise<unknown> } = {};
        const { handle } = api({
          store: f.store,
          contentModeration: {
            ...f.store,
            chatRemovalCommand: (input, work) =>
              f.store.chatRemovalCommand(
                { ...input, live: () => !expired && input.live() },
                async (removers) => {
                  retained.remove = removers.spectator;
                  const outcome = await work({
                    spectator: async () => {
                      calls.push('spectator');
                      return removers.spectator();
                    },
                    floor: async () => {
                      calls.push('floor');
                      return removers.floor();
                    },
                    room: async () => {
                      calls.push('room');
                      return removers.room();
                    },
                  });
                  if (fail) throw createAppError('CONFLICT');
                  return outcome;
                },
              ),
          },
          nextId: createId,
        });
        const input = {
          v: 1,
          commandId: createId(),
          adminAuditHead: 'c'.repeat(64),
        };
        commands.push(input.commandId);
        const put = (id = messageId, body = input) =>
          signed({
            method: 'PUT',
            path: `/operator/v1/chat-messages/${id}/removal`,
            body: JSON.stringify(body),
          });
        const refused = await handle(put());
        const [unchanged] =
          await f.sql`select text,removed_at is null as visible from messaging_messages where id=${messageId}`;
        const [before] =
          await f.sql`select count(*)::int as n from operator_command_receipts where command_id=${input.commandId}`;
        const expectedCalls = ['spectator', 'floor', 'room'].slice(
          0,
          index + 1,
        );
        assert({
          given: `a signed ${kind} removal with a late application failure`,
          should:
            'roll back message and receipt after only the required owner lookups',
          actual: [refused.status, unchanged, before!.n, calls],
          expected: [
            409,
            { text: 'Original message', visible: true },
            0,
            expectedCalls,
          ],
        });
        fail = false;
        expired = true;
        const deadline = await handle(put());
        const [restored] =
          await f.sql`select text,removed_at is null as visible from messaging_messages where id=${messageId}`;
        const [empty] =
          await f.sql`select count(*)::int as n from operator_command_receipts where command_id=${input.commandId}`;
        const escaped = await retained.remove?.().then(
          () => null,
          (error: { code: string }) => error.code,
        );
        assert({
          given:
            'an owner removal followed by expired final liveness and an escaped owner port',
          should:
            'roll back and reject the escaped owner port after the callback ends',
          actual: [deadline.status, restored, empty!.n, escaped],
          expected: [
            409,
            { text: 'Original message', visible: true },
            0,
            'INVARIANT',
          ],
        });
        expired = false;
        calls.length = 0;
        const applied = await handle(put());
        const replay = await handle(put());
        const conflict = await handle(put(createId()));
        const next = { ...input, commandId: createId() };
        commands.push(next.commandId);
        const second = await handle(put(messageId, next));
        const receipt = await handle(
          signed({
            method: 'GET',
            path: `/operator/v1/commands/${input.commandId}`,
          }),
        );
        const saved = await receipt.json();
        const [removed] =
          await f.sql`select text,removed_at is not null as removed from messaging_messages where id=${messageId}`;
        assert({
          given: `a fresh, replayed and already-removed ${kind} message`,
          should:
            'preserve first-found applied/unchanged, skip replay lookups, reject changed digest and retain issuer receipt',
          actual: [
            applied.status,
            await applied.json(),
            replay.status,
            await replay.json(),
            conflict.status,
            second.status,
            await second.json(),
            saved.action,
            saved.result,
            removed,
            calls,
          ],
          expected: [
            200,
            { v: 1, outcome: 'applied' },
            200,
            { v: 1, outcome: 'applied' },
            409,
            200,
            { v: 1, outcome: 'unchanged' },
            'chat_message.remove',
            { v: 1, outcome: 'applied' },
            { text: null, removed: true },
            [...expectedCalls, ...expectedCalls],
          ],
        });
      }
      const input = {
        v: 1,
        commandId: createId(),
        adminAuditHead: 'c'.repeat(64),
      };
      commands.push(input.commandId);
      const { handle } = api({
        store: f.store,
        contentModeration: f.store,
        nextId: createId,
      });
      const missing = await handle(
        signed({
          method: 'PUT',
          path: `/operator/v1/chat-messages/${createId()}/removal`,
          body: JSON.stringify(input),
        }),
      );
      const [receipt] =
        await f.sql`select count(*)::int as n from operator_command_receipts where command_id=${input.commandId}`;
      assert({
        given: 'a message absent from all three owners',
        should: 'return not-found with no receipt',
        actual: [missing.status, receipt!.n],
        expected: [404, 0],
      });
    } finally {
      for (const id of commands)
        await f.sql`delete from operator_command_receipts where command_id=${id}`;
      for (const id of channels)
        await f.sql`delete from messaging_channels where id=${id}`;
    }
  });
});
