import { SQL } from 'bun';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import {
  committingRuntimeTestDatabase,
  scratchDatabase,
} from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { committedEventRoom } from './tab-event-room-direction.test-support';
import { createBots } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readHostNavigation } from '../src/features/tab/reads/host-navigation';
import { hostNavigationRail } from '../src/features/tab/host-navigation';
import { readHostStandings } from '../src/features/tab/reads/host-standings';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { readTournamentEventSettings } from '../src/features/tab/reads/tournament-event-settings';
import { readEventBallot } from '../src/features/tab/reads/event-ballot';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

test('actual narrow lobby roles open only their host areas and rails, and current revocation removes the shell', async () => {
  const scratch = scratchDatabase(databaseUrl, 'hostareas');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 2 });
  try {
    await scratch.migrate(() => true);
    const world = await committedEventRoom(owner, 'copy', {
      noPrep: true,
      tournamentOwner: 'organization',
    });
    const lobbyId = world.made.get('tournament-lobby')!,
      eventId = world.made.get('event')!,
      organizationId = world.made.get('league')!;
    const store = createTabStore(committingRuntimeTestDatabase(owner));
    const dependencies = {
      store,
      authorize,
      now: () => new Date().toISOString(),
      newId: createId,
    };
    const command = organizationCommand(dependencies);
    const navigation = readHostNavigation(dependencies);
    const standings = readHostStandings(dependencies);
    const setup = readTournamentSetup(dependencies);
    const settings = readTournamentEventSettings(dependencies);
    const ballot = readEventBallot(dependencies);
    const people = await createBots(owner, [
      'Ballot reviewer only',
      'Results staff only',
    ]);
    for (const [index, permission] of [
      'tournament.ballots.read_unreleased',
      'tournament.results.enter',
    ].entries()) {
      const person = people[index]!,
        roleId = createId();
      // Custom-role editor is a separate feature. These real permission rows
      // are fixture inputs; the actual guarded grant command grants that role.
      await owner`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},${person.name},${50 + index},false)`;
      await owner`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},${permission})`;
      const [before] =
        await owner`select version from lobbies where id=${lobbyId}`;
      const granted = await command(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(before!.version) },
        command: {
          type: 'give-grant',
          scope: { kind: 'lobby', lobbyId },
          userId: person.userId,
          roleId,
          expiresAt: null,
        },
      });
      if (granted.kind !== 'accepted')
        throw new Error(
          `Actual narrow grant refused: ${JSON.stringify(granted)}`,
        );
      const nav = await navigation(as(person), { kind: 'lobby', id: lobbyId });
      const expectedArea =
        index === 0 ? 'lobby.host.ballots.read' : 'lobby.host.results.read';
      const resolved = await settings(as(person), {
        lobbyId,
        eventId,
        area: 'results',
      });
      assert({
        given: `the real ${permission} role with no other permission`,
        should:
          'open exactly its evaluated area, conceal setup and keep results metadata within the results area',
        actual: [
          nav?.areas,
          nav && hostNavigationRail(nav).items.map((item) => item.id),
          await setup(as(person), lobbyId),
          await settings(as(person), { lobbyId, eventId }),
          await ballot(as(person), { lobbyId, eventId }),
          (await standings(as(person), { lobbyId, eventId }))?.visibility ??
            null,
          resolved?.settings.map((row) => row.key) ?? null,
        ],
        expected: [
          [expectedArea],
          index === 0 ? ['ballots'] : ['break', 'results'],
          null,
          null,
          null,
          index === 0 ? null : 'official',
          index === 0
            ? null
            : ['standings.tiebreaks', 'standings.rating_ladder'],
        ],
      });
      const [grant] =
        await owner`select id from grants where lobby_id=${lobbyId} and user_id=${person.userId} and revoked_at is null`;
      const [current] =
        await owner`select version from lobbies where id=${lobbyId}`;
      const revoked = await command(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(current!.version) },
        command: {
          type: 'remove-grant',
          scope: { kind: 'lobby', lobbyId },
          grantId: String(grant!.id),
        },
      });
      assert({
        given:
          'the actual grant owner revoking the only role through its command',
        should:
          'remove the shell and every unreleased result without deleting its retained grant',
        actual: [
          revoked.kind,
          await navigation(as(person), { kind: 'lobby', id: lobbyId }),
          await standings(as(person), { lobbyId, eventId }),
          (
            await owner`select revoked_at is not null ended from grants where id=${grant!.id}`
          )[0]!.ended,
        ],
        expected: ['accepted', null, null, true],
      });
    }
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
