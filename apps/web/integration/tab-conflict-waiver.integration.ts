import { eventBallotAccess } from '../src/features/round-ballots/audience';
import { canReadRound } from '../src/features/round-runtime/reads';
import { readRoundOpening, roundWaitingOn } from '@daisy/debate-engine';
import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import {
  as,
  deniedAsNotFound,
  presetStaffRoleId,
} from './tab-tournament-organization-wiring.test-support';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { requestConflictWaiver } from '../src/features/tab/operations/conflict-waiver-request';
import { settlePendingCommand } from '../src/features/tab/operations/confirmation-command';
import { withRoomRuntime } from './room-runtime.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual connected read waiver is held, confirmed by a distinct current official, scoped and never a command grant', async () => {
  const scratch = scratchDatabase(databaseUrl, 'tabreadwaiver');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 1 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', { noPrep: true });
    const director = world.bots.Director!,
      lobbyId = world.made.get('tournament-lobby')!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const [fixture] =
      await owner`select f.id,j.actor_id from fixtures f join fixture_judges fj on fj.fixture_id=f.id join tournament_judges j on j.id=fj.tournament_judge_id where f.room_id=${world.roomId}`;
    const connected = Object.values(world.bots).find(
      (person) => person.actorId === fixture!.actor_id,
    )!;
    const organization = organizationCommand({
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    });
    const [lobby] =
      await owner`select version from lobbies where id=${lobbyId}`;
    const grant = await organization(as(director), {
      version: 1,
      commandId: createId(),
      expected: { lobby: Number(lobby!.version) },
      command: {
        type: 'give-grant',
        scope: { kind: 'lobby', lobbyId },
        userId: connected.userId,
        roleId: presetStaffRoleId,
        expiresAt: null,
      },
    });
    if (grant.kind !== 'accepted')
      throw new Error('Real connected official grant refused');
    const request = requestConflictWaiver({
        store,
        authorize,
        newId: createId,
      }),
      settle = settlePendingCommand({ store, authorize, newId: createId });
    await withRoomRuntime(
      async (f) => {
        const cast = await owner<
          { actor_id: string; user_id: string }[]
        >`select p.actor_id,a.user_id from room_participants p join actors a on a.id=p.actor_id where p.room_id=${world.roomId}`;
        for (const person of cast) {
          const caller = { actorId: person.actor_id, userId: person.user_id };
          await f.consent(
            caller,
            await f.operations.view(caller, world.roomId),
            'ready',
          );
        }
        const ready = await f.operations.view(director, world.roomId);
        const started = await f.operations.command(director, world.roomId, {
          type: 'start-round',
          commandId: createId(),
          expectedVersion: ready.version,
        });
        const roundId = started.receipt.roundRef!.id;
        const access = async () => {
          let parts: readonly string[] = [];
          await f.store.readLaunchedRound(
            roundId,
            connected,
            (round, account, authority) => {
              parts = eventBallotAccess(connected, authority).parts;
              return canReadRound(connected, round, account, authority);
            },
            readRoundOpening,
            roundWaitingOn,
            (authority) =>
              eventBallotAccess(connected, authority).parts.includes(
                'decision',
              ),
          );
          return {
            undelayed: (await f.roundView(connected, roundId))
              .viewerIsUndelayedObserver,
            parts,
          };
        };
        assert({
          given:
            'an actual seated official before confirmation on an actual started Round',
          should:
            'retain its seat read without undelayed official or unreleased ballot access',
          actual: await access(),
          expected: { undelayed: false, parts: [] },
        });
        const envelope = {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'request-conflict-waiver',
            fixtureId: String(fixture!.id),
            capability: 'round.observe.undelayed',
          },
        };
        const fault = new Error(
          'Controlled failure after actual finite waiver hold',
        );
        const failing = requestConflictWaiver({
          authorize,
          newId: createId,
          store: {
            conflictWaiverRequest: (input, work) =>
              store.conflictWaiverRequest(input, (session) =>
                work({
                  ...session,
                  hold: async (...args) => {
                    await session.hold(...args);
                    throw fault;
                  },
                }),
              ),
          },
        });
        let rolledBack = false;
        try {
          await failing(as(connected), lobbyId, envelope);
        } catch (error) {
          if (error !== fault) throw error;
          rolledBack = true;
        }
        assert({
          given:
            'a failure after real observation and finite hold were written',
          should: 'roll both back and allow exactly the same request to retry',
          actual: [
            rolledBack,
            (
              await owner`select count(*)::int n from pending_commands where command_id=${envelope.commandId}`
            )[0]!.n,
            (
              await owner`select count(*)::int n from conflicts where fixture_id=${fixture!.id} and user_id=${connected.userId}`
            )[0]!.n,
          ],
          expected: [true, 0, 0],
        });
        const held = await request(as(connected), lobbyId, envelope);
        if (held.kind !== 'pending')
          throw new Error(`Read waiver not held: ${JSON.stringify(held)}`);
        const [timing] =
          await owner`select extract(epoch from expires_at-created_at)*1000 ttl from pending_commands where command_id=${envelope.commandId}`;
        assert({
          given:
            'a genuinely seated Staff official requesting the actual fixture read',
          should:
            'persist canonical finite hold, replay the same deadline and confer no read waiver',
          actual: [
            Number(timing!.ttl),
            await request(as(connected), lobbyId, envelope),
            (
              await owner`select count(*)::int n from conflicts where fixture_id=${fixture!.id} and confirmed_by_user_id is not null`
            )[0]!.n,
          ],
          expected: [300000, held, 0],
        });
        const confirmation = {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'confirm-command',
            pendingCommandId: envelope.commandId,
          },
        };
        assert({
          given:
            'self-confirmation, foreign tenant, and a stranger to current authority',
          should: 'hide the request without granting access',
          actual: [
            await deniedAsNotFound(() =>
              settle(as(connected), lobbyId, confirmation),
            ),
            await deniedAsNotFound(() =>
              request(
                as(connected),
                world.made.get('standing-lobby')!,
                envelope,
              ),
            ),
            await deniedAsNotFound(() =>
              settle(as(world.bots.Coach!), lobbyId, confirmation),
            ),
          ],
          expected: [true, true, true],
        });
        const confirmed = await settle(as(director), lobbyId, confirmation);
        if (confirmed.kind !== 'accepted')
          throw new Error(
            `Waiver confirmation refused: ${JSON.stringify(confirmed)}`,
          );
        const [saved] =
          await owner`select user_id,confirmed_by_user_id,basis from conflicts where fixture_id=${fixture!.id} and confirmed_by_user_id is not null`;
        assert({
          given:
            'a different current Director confirming the retained actual conflict',
          should:
            'write real principals and immutable original/confirmation receipt replay without duplicating the waiver',
          actual: [
            saved!.user_id,
            saved!.confirmed_by_user_id,
            saved!.basis,
            (await request(as(connected), lobbyId, envelope)).kind,
            (await settle(as(director), lobbyId, confirmation)).kind,
            await request(as(connected), lobbyId, {
              ...envelope,
              commandId: createId(),
            }),
          ],
          expected: [
            connected.userId,
            director.userId,
            'seated',
            'accepted',
            'accepted',
            { kind: 'refused', refusal: 'waiver-exists' },
          ],
        });
        assert({
          given:
            'a second-person waiver resolved through the actual ordinary Round and ballot read owners',
          should: 'admit current undelayed official and all unreleased parts',
          actual: await access(),
          expected: {
            undelayed: true,
            parts: ['decision', 'scores', 'reason', 'feedback'],
          },
        });
        assert({
          given:
            'the other waivable read on the same already confirmed fixture',
          should:
            'reuse the retained fixture-scoped waiver and refuse a duplicate proposal',
          actual: await request(as(connected), lobbyId, {
            ...envelope,
            commandId: createId(),
            command: {
              ...envelope.command,
              capability: 'tournament.ballots.read_unreleased',
            },
          }),
          expected: { kind: 'refused', refusal: 'waiver-exists' },
        });
        const view = await f.operations.view(connected, world.roomId);
        assert({
          given:
            'the read waiver and a connected official asking for ordinary Room management',
          should: 'continue to refuse an unconfirmed command grant',
          actual: view.capabilities.host,
          expected: false,
        });
        const [currentLobby] =
          await owner`select version from lobbies where id=${lobbyId}`;
        const [actualGrant] =
          await owner`select id from grants where lobby_id=${lobbyId} and user_id=${connected.userId} and revoked_at is null`;
        const removed = await organization(as(director), {
          version: 1,
          commandId: createId(),
          expected: { lobby: Number(currentLobby!.version) },
          command: {
            type: 'remove-grant',
            scope: { kind: 'lobby', lobbyId },
            grantId: String(actualGrant!.id),
          },
        });
        if (removed.kind !== 'accepted')
          throw new Error('Current waiver-reader grant revocation refused');
        assert({
          given: 'the retained waiver after real scoped grant revocation',
          should: 'confer no authority while its immutable history remains',
          actual: [
            await access(),
            (
              await owner`select count(*)::int n from conflicts where fixture_id=${fixture!.id} and confirmed_by_user_id is not null`
            )[0]!.n,
          ],
          expected: [{ undelayed: false, parts: [] }, 1],
        });
      },
      { databaseUrl: scratch.url },
    );
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
