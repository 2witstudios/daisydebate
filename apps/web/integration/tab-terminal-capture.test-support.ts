import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { scratchDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { isDebatingSeat } from '@daisy/protocol';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { withRoomRuntime } from './room-runtime.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { createRoundRuntimeOperations } from '../src/features/round-runtime/operations';
type Runtime = Parameters<Parameters<typeof withRoomRuntime>[0]>[0];
type CaptureFixture = {
  readonly f: Runtime;
  readonly owner: SQL;
  readonly world: Awaited<ReturnType<typeof committedEventRoom>>;
  readonly rooms: readonly { readonly room_id: string }[];
  readonly start: (roomId: string) => Promise<string>;
  readonly end: (roundId: string) => Promise<void>;
};
const { databaseUrl } = requireTestServices(process.env);
/** Real Start/forfeit/capture ownership in a private committed database; every physical timestamp uses the production default. */
export async function withTerminalCapture(
  run: (fixture: CaptureFixture) => Promise<void>,
) {
  const scratch = scratchDatabase(databaseUrl, 'terminalcapture');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      recording: 'on',
      hosting: 'granted',
    });
    const director = world.bots.Director!,
      lobbyId = world.made.get('tournament-lobby')!;
    await seedHostingGrant(owner, director.userId, {
      tournamentIds: [lobbyId],
      replaceCurrent: true,
    });
    const rooms = await owner<
      { room_id: string }[]
    >`select room_id from fixtures where tab_round_id=${world.made.get('tab-round')!} order by room_id`;
    await withRoomRuntime(
      async (f) => {
        const runtime = createRoundRuntimeOperations({
          store: f.store,
          nextSegmentId: createId,
        });
        const start = async (roomId: string) => {
          const cast = await owner<
            { actor_id: string; user_id: string }[]
          >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${roomId}`;
          for (const person of cast) {
            const caller = { actorId: person.actor_id, userId: person.user_id };
            await f.consent(
              caller,
              await f.operations.view(caller, roomId),
              'ready',
            );
          }
          const ready = await f.operations.view(director, roomId);
          const answer = await f.operations.command(director, roomId, {
            type: 'start-round',
            commandId: createId(),
            expectedVersion: ready.version,
          });
          return answer.receipt.roundRef!.id;
        };
        const end = async (roundId: string) => {
          const round = (await f.store.getRound(roundId))!,
            speaker = round.participants.find((person) =>
              isDebatingSeat(person.seat),
            )!;
          if (!speaker.actorId) throw new Error('Real forfeit caller missing');
          await runtime.command(
            { kind: 'human', actorId: speaker.actorId },
            roundId,
            {
              version: 1,
              commandId: createId(),
              expectedVersion: round.version,
              command: { type: 'forfeit', participantId: speaker.id },
            },
          );
        };
        await run({ f, owner, world, rooms, start, end });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}
