import { proveCaptureSubjectRights } from './tab-capture-privacy.test-support';
import { proveTournamentCaptureControl } from './tab-tournament-capture-control.test-support';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { isAppError } from '@daisy/errors';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { withRoomRuntime } from './room-runtime.test-support';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { createBots } from './tab-tournament.test-support';
import { seedHostingGrant } from './tab-hosting-grant.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { tournamentSponsorshipCommand } from '../src/features/tab/operations/tournament-sponsorship';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual officials-recording Start requires explicit separate sponsorship and atomically freezes finite capacity/source without a host', async () => {
  const scratch = scratchDatabase(databaseUrl, 'captureadmission');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      recording: 'on',
      tournamentOwner: 'organization',
    });
    const [sponsor] = await createBots(owner, ['Funding account']);
    if (!sponsor) throw new Error('funding account missing');
    const lobbyId = world.made.get('tournament-lobby')!,
      director = world.bots.Director!;
    await withRoomRuntime(
      async (f) => {
        const seated = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
        for (const person of seated) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, world.roomId),
            'ready',
          );
        }
        await owner`delete from account_entitlement_grants where user_id=${director.userId} and entitlement='casual_capture'`;
        assert({
          given: 'the actual acting tournament official',
          should:
            'hold no personal casual-capture benefit for the independent funding proof',
          actual: Number(
            (
              await owner`select count(*)::int as n from account_entitlement_grants where user_id=${director.userId} and entitlement='casual_capture'`
            )[0]!.n,
          ),
          expected: 0,
        });
        const view = await f.operations.view(director, world.roomId),
          start = {
            commandId: createId(),
            expectedVersion: view.version,
            type: 'start-round',
          } as const;
        const before = await f.snapshot(world.roomId);
        let unpaid = false;
        try {
          await f.operations.command(director, world.roomId, start);
        } catch (error) {
          if (!isAppError(error)) throw error;
          unpaid = error.code === 'CONFLICT';
        }
        assert({
          given:
            'a genuinely ready officials-recording event Room, current official authority and a creation-only owner grant',
          should:
            'refuse capture without inventing a host, payer or sponsorship and rollback all Start effects',
          actual: [unpaid, before === (await f.snapshot(world.roomId))],
          expected: [true, true],
        });
        const hostingVersionId = await owner.begin((sql) =>
          seedHostingGrant(sql, sponsor.userId, {
            tournamentIds: [lobbyId],
            issuerOperatorRef: createId(),
            validForMs: 12_000,
          }),
        );
        const send = tournamentSponsorshipCommand({
          store: createTabStore(committingRuntimeTestDatabase(owner)),
          authorize,
          newId: createId,
        });
        const [lobby] =
          await owner`select version from lobbies where id=${lobbyId}`;
        const proposed = await send(as(director), {
          version: 1,
          commandId: createId(),
          expected: { lobby: Number(lobby!.version) },
          command: {
            type: 'propose-tournament-sponsorship',
            lobbyId,
            sponsorUserId: sponsor.userId,
          },
        });
        if (proposed.kind !== 'accepted')
          throw new Error('funding proposal refused');
        const [proposal] =
          await owner`select id from tournament_sponsorship_versions where lobby_id=${lobbyId} order by version desc limit 1`;
        let proposalOnly = false;
        try {
          await f.operations.command(director, world.roomId, start);
        } catch (error) {
          if (!isAppError(error)) throw error;
          proposalOnly = true;
        }
        assert({
          given:
            'a real covered funding account and organization proposal without account acceptance',
          should: 'still refuse Start with zero writes',
          actual: [proposalOnly, before === (await f.snapshot(world.roomId))],
          expected: [true, true],
        });
        const accepted = await send(as(sponsor), {
          version: 1,
          commandId: createId(),
          expected: { lobby: proposed.receipt.resultingVersion },
          command: {
            type: 'accept-tournament-sponsorship',
            lobbyId,
            proposalId: String(proposal!.id),
            hostingVersionId,
          },
        });
        if (accepted.kind !== 'accepted')
          throw new Error('funding consent refused');
        const launched = await f.operations.command(
          director,
          world.roomId,
          start,
        );
        const replay = await f.operations.command(
          director,
          world.roomId,
          start,
        );
        const [stored] =
          await owner`select a.admission,a.deadline_at,a.sponsor_user_id,a.official_user_id,r.created_by_actor_id,room.host_actor_id,c.command_id from tournament_capture_admissions a join rounds r on r.id=a.round_id join rooms room on room.id=a.room_id join room_commands c on c.command_id=a.command_id where a.room_id=${world.roomId}`;
        if (!stored)
          throw new Error('actual admitted Start lacks capture provenance');
        const frozen = stored.admission as {
          id: string;
          roundId: string;
          basis:
            | {
                kind: 'grant';
                grant: { hosting: { id: string; expiresAt: string } };
              }
            | { kind: 'hosting-purchase' };
          deadlineAt: string;
          admittedAt: string;
          funding: { sponsorshipVersionId: string };
          capacity: {
            fleetLimit: number;
            sponsorLimit: number;
            tournamentLimit: number;
          };
        };
        assert({
          given:
            'actual organization consent and separate current Room official',
          should:
            'commit exactly one finite named funding/capacity obligation with the ordinary Round/receipt, retain host-null and replay without extension',
          actual: {
            host: stored.host_actor_id,
            createdBy: stored.created_by_actor_id,
            sponsor: stored.sponsor_user_id,
            official: stored.official_user_id,
            grant:
              frozen.basis.kind === 'grant'
                ? frozen.basis.grant.hosting.id
                : null,
            command: stored.command_id,
            finite:
              Date.parse(frozen.admittedAt) < Date.parse(frozen.deadlineAt) &&
              frozen.basis.kind === 'grant' &&
              Date.parse(frozen.deadlineAt) <=
                Date.parse(frozen.basis.grant.hosting.expiresAt),
            capacity: frozen.capacity,
            round: frozen.roundId === launched.receipt.roundRef?.id,
            replay: replay.receipt.replayed,
            admissions: Number(
              (
                await owner`select count(*)::int as n from tournament_capture_admissions where room_id=${world.roomId}`
              )[0]!.n,
            ),
          },
          expected: {
            host: null,
            createdBy: null,
            sponsor: sponsor.userId,
            official: director.userId,
            grant: hostingVersionId,
            command: start.commandId,
            finite: true,
            capacity: {
              kind: 'nonranked-egress',
              fleetLimit: 1,
              sponsorLimit: 1,
              tournamentLimit: 1,
            },
            round: true,
            replay: true,
            admissions: 1,
          },
        });
        await proveTournamentCaptureControl({
          f,
          owner,
          roundId: frozen.roundId,
          hostingVersionId,
        });
        await proveCaptureSubjectRights({
          f,
          owner,
          roundId: frozen.roundId,
          hostingVersionId,
          funder: sponsor,
          official: director,
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
