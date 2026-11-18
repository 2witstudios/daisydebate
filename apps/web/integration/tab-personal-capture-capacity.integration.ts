import { SQL } from 'bun';
import { requireTestServices } from '@daisy/config';
import { createId } from '@paralleldrive/cuid2';
import { tournamentCaptureAdmissionSchema } from '@daisy/protocol';
import { isAppError } from '@daisy/errors';
import { scratchDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual personal-owner concurrent Starts reserve one finite slot and expiry fences never-dispatched cleanup against restart', async () => {
  const scratch = scratchDatabase(databaseUrl, 'personalcapacity');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      recording: 'on',
      tournamentOwner: 'personal',
    });
    const director = world.bots.Director!,
      lobbyId = world.made.get('tournament-lobby')!;
    const roomRows = await owner<
      { id: string }[]
    >`select room_id as id from fixtures where tab_round_id=${world.made.get('tab-round')!} order by room_id`;
    if (roomRows.length !== 2)
      throw new Error('The original real draw must publish two fixtures');
    await withRoomRuntime(
      async (f) => {
        const rooms = [];
        for (const { id } of roomRows) {
          const participants = await owner<
            { actor_id: string; user_id: string }[]
          >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${id}`;
          for (const p of participants) {
            const caller = { actorId: p.actor_id, userId: p.user_id };
            await f.consent(
              caller,
              await f.operations.view(caller, id),
              'ready',
            );
          }
          const view = await f.operations.view(director, id);
          rooms.push({
            id,
            before: await f.snapshot(id),
            command: {
              type: 'start-round' as const,
              commandId: createId(),
              expectedVersion: view.version,
            },
          });
        }
        const hostingVersionId = await owner.begin((sql) =>
          seedHostingGrant(sql, director.userId, {
            tournamentIds: [lobbyId],
            replaceCurrent: true,
            validForMs: 5000,
          }),
        );
        const outcomes = await Promise.all(
          rooms.map(async (room) => {
            try {
              return {
                kind: 'accepted' as const,
                room,
                result: await f.operations.command(
                  director,
                  room.id,
                  room.command,
                ),
              };
            } catch (error) {
              if (!isAppError(error)) throw error;
              return { kind: 'refused' as const, room, code: error.code };
            }
          }),
        );
        const winner = outcomes.find((row) => row.kind === 'accepted'),
          loser = outcomes.find((row) => row.kind === 'refused');
        if (winner?.kind !== 'accepted' || loser?.kind !== 'refused')
          throw new Error(
            'Concurrent Starts did not discriminate the physical capacity boundary',
          );
        const [admission] =
          await owner`select id,round_id,admission,deadline_at from tournament_capture_admissions where lobby_id=${lobbyId}`;
        if (!admission)
          throw new Error('The actual Start did not commit its admission');
        const frozenBytes = JSON.stringify(admission.admission);
        const source = tournamentCaptureAdmissionSchema.parse(
          admission.admission,
        );
        assert({
          given:
            'two genuinely published and Ready Rooms with one personal owner and explicitly covered hosting',
          should:
            'commit one Round/receipt/admission and roll back the competing Room without requiring organization sponsorship or inventing a host',
          actual: [
            outcomes.filter((row) => row.kind === 'accepted').length,
            loser.code,
            (await f.snapshot(loser.room.id)) === loser.room.before,
            Number(
              (
                await owner`select count(*)::int as n from tournament_capture_admissions where lobby_id=${lobbyId}`
              )[0]!.n,
            ),
            source.funding.kind,
            source.funding.kind === 'personal-owner'
              ? source.funding.ownerUserId
              : null,
            source.grant.hosting.id,
            Number(
              (
                await owner`select count(*)::int as n from tournament_sponsorship_versions where lobby_id=${lobbyId}`
              )[0]!.n,
            ),
          ],
          expected: [
            1,
            'CONFLICT',
            true,
            1,
            'personal-owner',
            director.userId,
            hostingVersionId,
            0,
          ],
        });
        const database = f.store;
        const recording = await database.requestRecording({
          id: createId(),
          roundId: String(admission.round_id),
          class: 'casual',
          eligibility: {
            kind: 'tournament_admission',
            admissionId: String(admission.id),
            deadlineAt: admission.deadline_at.toISOString(),
          },
        });
        await database.recordingCaptures.openOwn({
          recordingId: recording.id,
          roundId: String(admission.round_id),
        });
        await owner`select pg_sleep(greatest(0,extract(epoch from (deadline_at-clock_timestamp())))+0.02) from tournament_capture_admissions where id=${String(admission.id)}`;
        const raced = await Promise.all([
          database.recordingCaptures.beginOwnEgressAttempt({
            recordingId: recording.id,
            generation: 1,
            stageCredentialHash: 'a'.repeat(64),
          }),
          database.recordingCaptures.settleUndispatchedTournamentAdmission(
            String(admission.round_id),
          ),
        ]);
        const replay = await f.operations.command(
          director,
          winner.room.id,
          winner.room.command,
        );
        const expiredBefore = await f.snapshot(loser.room.id);
        let expiredRefusal = false;
        try {
          await f.operations.command(director, loser.room.id, {
            ...loser.room.command,
            commandId: createId(),
          });
        } catch (error) {
          if (!isAppError(error)) throw error;
          expiredRefusal = error.code === 'CONFLICT';
        }
        const [closed] =
          await owner`select admission,settled_at from tournament_capture_admissions where id=${String(admission.id)}`;
        assert({
          given:
            'the real finite DB deadline, no dispatched provider call, and concurrent cleanup/dispatch followed by command replay',
          should:
            'prove no physical work exists before releasing once, refuse any new Start, preserve immutable receipt/source and deny all deadline extension',
          actual: [
            raced,
            closed!.settled_at !== null,
            replay.receipt.replayed,
            JSON.stringify(closed!.admission) === frozenBytes,
            expiredRefusal,
            (await f.snapshot(loser.room.id)) === expiredBefore,
            await database.recordingCaptures.settleUndispatchedTournamentAdmission(
              String(admission.round_id),
            ),
            Number(
              (
                await owner`select running from daisy_nonranked_capture_capacity(${createId()},null,null,null)`
              )[0]!.running,
            ),
          ],
          expected: [[false, true], true, true, true, true, true, true, 0],
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
