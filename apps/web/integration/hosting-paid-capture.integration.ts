import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { tournamentCaptureAdmissionSchema } from '@daisy/protocol';
import { scratchDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('a personal tournament paid for funds its own recording with no hosting grant (ADR 0149)', async () => {
  const scratch = scratchDatabase(databaseUrl, 'paidcapture');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    // The fixture pays the tournament to unlimited before switching recording on.
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      recording: 'on',
      tournamentOwner: 'personal',
    });
    const director = world.bots.Director!,
      lobbyId = world.made.get('tournament-lobby')!;
    const [grants] =
      await owner`select count(*)::int n from account_entitlement_grants g join account_hosting_versions v on v.id=g.hosting_version_id where g.user_id=${director.userId} and g.entitlement='tournament_hosting' and v.coverage->'tournamentIds' ? ${lobbyId}`;
    const [room] = await owner<
      { id: string }[]
    >`select room_id as id from fixtures where tab_round_id=${world.made.get('tab-round')!} order by room_id limit 1`;
    if (!room) throw new Error('The draw published no fixture');
    await withRoomRuntime(
      async (f) => {
        const participants = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${room.id}`;
        for (const p of participants) {
          const caller = { actorId: p.actor_id, userId: p.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, room.id),
            'ready',
          );
        }
        const view = await f.operations.view(director, room.id);
        await f.operations.command(director, room.id, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: view.version,
        });
        const [admission] =
          await owner`select admission, hosting_version_id, hosting_purchase_id from tournament_capture_admissions where lobby_id=${lobbyId}`;
        const [purchase] =
          await owner`select id from tournament_hosting_purchases where lobby_id=${lobbyId} and state='paid'`;
        const frozen = tournamentCaptureAdmissionSchema.parse(
          admission?.admission,
        );
        assert({
          given:
            'a personal tournament paid to unlimited, recording on, and no hosting grant naming it',
          should:
            'admit the Round’s capture on the purchase, at the unlimited tier’s concurrency',
          actual: {
            grants: Number(grants!.n),
            basis: frozen.basis.kind,
            purchase:
              frozen.basis.kind === 'hosting-purchase'
                ? frozen.basis.purchase.id === purchase!.id
                : false,
            columns: [
              admission!.hosting_version_id,
              admission!.hosting_purchase_id === purchase!.id,
            ],
            capacity: [
              frozen.capacity.sponsorLimit,
              frozen.capacity.tournamentLimit,
            ],
          },
          expected: {
            grants: 0,
            basis: 'hosting-purchase',
            purchase: true,
            columns: [null, true],
            capacity: [64, 64],
          },
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 120_000);
