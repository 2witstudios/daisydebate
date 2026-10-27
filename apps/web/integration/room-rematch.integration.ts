import { requireTestServices } from '@daisy/config';
import { assertRejects } from '@daisy/errors/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  startRuntimeRound,
  withRoomRuntime,
} from './round-runtime.test-support';
setupRitewayBun();
requireTestServices(process.env);

test('a fresh Room after an actual result preserves the original aggregate and requires a new cast', async () => {
  await withRoomRuntime(async (f) => {
    const room = await f.assemble();
    const body = {
      commandId: createId(),
      title: 'Fresh rematch',
      topic: 'Libraries should remain public',
      visibility: 'public' as const,
      selection: f.foundationSelection,
    };
    const { roundId, operations } = await startRuntimeRound(f, room);
    await assertRejects({
      given: 'an active original Round',
      should: 'refuse a rematch without creating another Room',
      actual: () => f.operations.rematch(f.host, room.id, body),
      code: 'CONFLICT',
    });
    const active = (await f.store.getRound(roundId))!;
    await operations.command(
      { kind: 'human', actorId: f.host.actorId },
      roundId,
      {
        version: 1,
        commandId: createId(),
        expectedVersion: active.version,
        command: {
          type: 'forfeit',
          participantId: active.participants.find(
            (p) => p.actorId === f.host.actorId,
          )!.id,
        },
      },
    );
    const before = await f.snapshot(room.id);
    await assertRejects({
      given: 'a seated non-host after the result',
      should: 'refuse host rematch authority',
      actual: () => f.operations.rematch(f.guest, room.id, body),
      code: 'AUTHORIZATION',
    });
    const created = await f.operations.rematch(f.host, room.id, body);
    try {
      const replay = await f.operations.rematch(f.host, room.id, body);
      await assertRejects({
        given: 'an acknowledged creation command reused with different details',
        should: 'refuse a second creation',
        actual: () =>
          f.operations.rematch(f.host, room.id, {
            ...body,
            topic: 'Changed command payload',
          }),
        code: 'CONFLICT',
      });
      await f.sql`update users set username='' where id=${f.host.userId}`;
      await assertRejects({
        given:
          'the source host losing canonical member eligibility after acknowledgement',
        should: 'hide the unauthorized source even for an exact retry',
        actual: () => f.operations.rematch(f.host, room.id, body),
        code: 'NOT_FOUND',
      });
      await f.sql`update users set username=${`u-${f.host.userId}`} where id=${f.host.userId}`;

      const [roomCount] =
        await f.sql`select count(*)::int value from rooms where host_actor_id=${f.host.actorId}`;
      assert({
        given:
          'the current host explicitly choosing a current format after a durable result',
        should:
          'create one new empty assembly with no Round or old Ready and leave the started source unchanged',
        actual: [
          roomCount!.value,
          created.view.id !== room.id,
          created.view.status,
          created.view.roundRef,
          created.view.participants.length === 0 &&
            created.view.readiness.readyActorIds.length === 0,
          replay.receipt.roomId === created.receipt.roomId,
          JSON.stringify(await f.snapshot(room.id)) === JSON.stringify(before),
        ],
        expected: [2, true, 'assembling', null, true, true, true],
      });
    } finally {
      await f.sql`delete from outbox where topic=${`room:${created.view.id}`}`;
      await f.sql`delete from rooms where id=${created.view.id}`;
    }
  });
});
