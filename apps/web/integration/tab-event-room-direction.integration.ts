import { proveEventRoundRead } from './tab-event-round-read.test-support';
import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase } from '@daisy/db/testing';
import { isAppError } from '@daisy/errors';
import { noopErrorReporter } from '@daisy/observability';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createRoomHandlers } from '../src/features/room-runtime/handlers';
import { readAssembly } from '../src/features/rooms/read-assembly';
import { inProcessFetch } from '../src/server/in-process-fetch';
import { silentLogger } from '../src/server/test-loggers.test-support';
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
          const origin = 'http://localhost:3000';
          const budget = { max: 20, windowSeconds: 60 };
          const handlers = createRoomHandlers({
            operations: f.operations,
            logger: silentLogger,
            reporter: noopErrorReporter,
            origin: () => origin,
            identify: async () => ({
              state: 'member',
              username: 'Director',
              principal: { kind: 'user', ...director },
            }),
            limiter: () => ({
              consume: async () => ({ allowed: true, retryAfterSeconds: 0 }),
            }),
            limits: { create: budget, read: budget, command: budget },
            maxBodyBytes: 4096,
          });
          const fetch = inProcessFetch(
            (request) => handlers.read(request, world.roomId),
            new Headers({ origin }),
          );
          const readEventAssembly = async () => {
            const result = await readAssembly(fetch, world.roomId, 'event');
            if (result.kind !== 'found')
              throw new Error(`Expected the event Room, got ${result.kind}`);
            return result.view;
          };
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
          const tabRoundId = world.made.get('tab-round')!;
          const [pinned] = await owner<
            { releasedAt: Date | null; topic: string | null }[]
          >`select t.resolution_released_at as "releasedAt", r.topic
            from tab_rounds t join fixtures f on f.tab_round_id=t.id
            join rooms r on r.id=f.room_id
            where t.id=${tabRoundId} and r.id=${world.roomId}`;
          if (!pinned?.releasedAt || !pinned.topic)
            throw new Error('The fixture needs its published topic');
          await owner`update tab_rounds set resolution_released_at=null where id=${tabRoundId}`;
          const waiting = await readEventAssembly();
          const beforeRelease = await f.snapshot(world.roomId);
          const refusedStart = await f.operations
            .command(director, world.roomId, start)
            .then(
              () => null,
              (error: unknown) => {
                if (!isAppError(error)) throw error;
                return error.reason;
              },
            );
          assert({
            given: 'a Ready event Room whose stored topic is still held',
            should: 'hide the topic and refuse Start without a Room change',
            actual: [
              waiting.topic,
              JSON.stringify(waiting).includes(pinned.topic),
              waiting.startRefusal,
              refusedStart,
              (await f.snapshot(world.roomId)) === beforeRelease,
            ],
            expected: [
              null,
              false,
              'resolution-not-released',
              'resolution-not-released',
              true,
            ],
          });
          await owner`update tab_rounds set resolution_released_at=${pinned.releasedAt} where id=${tabRoundId}`;
          const released = await readEventAssembly();
          assert({
            given: 'the same event Room after its stored release',
            should: 'show the exact pinned topic and lift the Start refusal',
            actual: [released.topic, released.startRefusal],
            expected: [pinned.topic, null],
          });
          const response = await f.operations.command(
            director,
            world.roomId,
            start,
          );
          await proveEventRoundRead({
            f,
            owner,
            world,
            roundId: response.receipt.roundRef!.id,
          });
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
