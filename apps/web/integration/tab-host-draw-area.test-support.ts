import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import {
  hostRoundViewSchema,
  hostDrawOverviewSchema,
} from '@daisy/protocol/lobby/draw-read';
import {
  hostRoundPath,
  hostDrawOverviewPath,
} from '../src/features/tab/host-draw-route';
import {
  hostDrawHttp,
  hostDrawRequest,
} from './tab-tournament-host-draw.test-support';
import { createBots, type World } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { readHostResults } from '../src/features/tab/reads/host-results';
import { readHostBallots } from '../src/features/tab/reads/host-ballots';
/** A narrow real Draw grant opens its own area and closes immediately on canonical revocation. */
export async function proveDrawArea(world: World) {
  const { sql } = world;
  const lobbyId = world.made.get('tournament-lobby')!,
    eventId = world.made.get('event')!,
    tabRoundId = world.made.get('tab-round')!;
  const [lobby] =
    await sql`select owner_organization_id from lobbies where id=${lobbyId}`;
  const [viewer] = await createBots(sql, ['Draw only']);
  if (!viewer) throw new Error('The Draw account was not created');
  const roleId = createId(),
    organizationId = String(lobby!.owner_organization_id);
  // The separate role editor is not in this slice; the guarded grant consumes an actual permission row.
  await sql`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},'Draw only',52,false)`;
  await sql`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},'tournament.draw.edit')`;
  const store = createTabStore(world.database),
    dependencies = { store, authorize, now: world.clock.now, newId: createId };
  const command = organizationCommand(dependencies);
  const [before] = await sql`select version from lobbies where id=${lobbyId}`;
  const given = await command(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(before!.version) },
    command: {
      type: 'give-grant',
      scope: { kind: 'lobby', lobbyId },
      userId: viewer.userId,
      roleId,
      expiresAt: null,
    },
  });
  const http = hostDrawHttp(world, viewer);
  const address = hostRoundPath({ lobbyId, eventId, tabRoundId });
  const round = await http.round(hostDrawRequest(address)),
    overview = await http.overview(
      hostDrawRequest(hostDrawOverviewPath(lobbyId)),
    );
  assert({
    given:
      'an actual tournament.draw.edit role with no Setup or other host permissions',
    should:
      'open both own-area Draw reads through HTTP and conceal other areas',
    actual: [
      given.kind,
      round.status,
      round.status === 200
        ? hostRoundViewSchema.parse(await round.json()).kind
        : null,
      overview.status,
      overview.status === 200
        ? hostDrawOverviewSchema
            .parse(await overview.json())
            .events.some((event) => event.eventId === eventId)
        : false,
      await readTournamentSetup(dependencies)(as(viewer), lobbyId),
      await readHostResults(dependencies)(as(viewer), { lobbyId, eventId }),
      await readHostBallots(dependencies)(as(viewer), { lobbyId, eventId }),
    ],
    expected: ['accepted', 200, 'published', 200, true, null, null, null],
  });
  const [grant] =
    await sql`select id from grants where lobby_id=${lobbyId} and user_id=${viewer.userId} and revoked_at is null`;
  const [current] = await sql`select version from lobbies where id=${lobbyId}`;
  const removed = await command(as(world.bots.Director!), {
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
    given: 'canonical revocation of the only Draw grant',
    should: 'conceal both retained Draw HTTP reads immediately',
    actual: [
      removed.kind,
      (await http.round(hostDrawRequest(address))).status,
      (await http.overview(hostDrawRequest(hostDrawOverviewPath(lobbyId))))
        .status,
    ],
    expected: ['accepted', 404, 404],
  });
}
