import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase } from '@daisy/db/testing';
import { isAppError } from '@daisy/errors';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const refused = async (work: () => Promise<unknown>) => {
  try {
    await work();
    return false;
  } catch (error) {
    if (!isAppError(error)) throw error;
    return true;
  }
};
for (const mode of ['copy', 'detach'] as const)
  test(`foreign ${mode} ballot survives actual human Ready and current official Start with null host`, async () => {
    const scratch = scratchDatabase(databaseUrl, `eventstart${mode}`);
    await scratch.create();
    const owner = new SQL(scratch.url, { max: 1 });
    try {
      await scratch.migrate(() => true);
      const world = await committedEventRoom(owner, mode);
      await withRoomRuntime(
        async (f) => {
          const director = world.bots.Director!,
            outsider = world.bots.Coach!;
          let view = await f.operations.view(director, world.roomId);
          const command = {
            commandId: createId(),
            expectedVersion: view.version,
            type: 'start-round' as const,
          };
          const before = await f.snapshot(world.roomId);
          assert({
            given: 'a published hostless Room before humans Ready',
            should:
              'refuse both a non-official and early official Start atomically',
            actual: [
              await refused(() =>
                f.operations.command(outsider, world.roomId, command),
              ),
              await refused(() =>
                f.operations.command(director, world.roomId, command),
              ),
              await f.snapshot(world.roomId),
            ],
            expected: [true, true, before],
          });
          const cast = await owner<
            { actor_id: string; user_id: string }[]
          >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId} order by p.id`;
          for (const seat of cast) {
            const caller = { actorId: seat.actor_id, userId: seat.user_id };
            await f.consent(
              caller,
              await f.operations.view(caller, world.roomId),
              'ready',
            );
          }
          view = await f.operations.view(director, world.roomId);
          const start = { ...command, expectedVersion: view.version };
          const response = await f.operations.command(
            director,
            world.roomId,
            start,
          );
          const replay = await f.operations.command(
            director,
            world.roomId,
            start,
          );
          const [row] =
            await owner`select r.created_by_actor_id,r.judging,r.ballot_definition_id,r.ballot_definition_version,rm.host_actor_id,rm.capture from rounds r join rooms rm on rm.id=r.room_id where r.id=${response.receipt.roundRef!.id}`;
          const [definition] =
            await owner`select definition from ballot_definition_versions where ballot_definition_id=${world.made.get('copied-ballot')!} and version=1`;
          assert({
            given:
              'all actual humans Ready through ordinary Room commands and a current event owner directing Start',
            should:
              'freeze the exact owned foreign copy, keep real null identities, honor off policy and replay one Round',
            actual: [
              row!.created_by_actor_id,
              row!.host_actor_id,
              row!.ballot_definition_id,
              Number(row!.ballot_definition_version),
              row!.judging.ballot,
              row!.capture,
              replay.receipt.replayed,
              replay.receipt.roundRef,
            ],
            expected: [
              null,
              null,
              world.made.get('copied-ballot')!,
              1,
              definition!.definition,
              { broadcast: null, recordingPolicy: 'off' },
              true,
              response.receipt.roundRef,
            ],
          });
        },
        { databaseUrl: scratch.url },
      );
    } finally {
      await owner.close();
      await scratch.drop();
    }
  }, 60_000);
