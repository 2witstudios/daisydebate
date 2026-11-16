import { setupCommand } from '../src/features/tab/operations/setup';
import { createId } from '@paralleldrive/cuid2';
import { assert } from 'riteway/bun';
import { authorize } from '@daisy/auth/authorization';
import { createTabStore } from '@daisy/db/tab';
import { noopErrorReporter } from '@daisy/observability';
import { hostEventsViewSchema } from '@daisy/protocol/lobby/host-events-read';
import {
  createHostEventsRoute,
  hostEventsPath,
} from '../src/features/tab/host-events-route';
import { readHostEvents } from '../src/features/tab/reads/host-events';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { createBots, type World } from './tab-tournament.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
/** The actual authoring area never loans resolution-word authority from Setup. */
export async function proveEventsArea(world: World) {
  const lobbyId = world.made.get('tournament-lobby')!,
    organizationId = world.made.get('league')!,
    sql = world.sql;
  const store = createTabStore(world.database),
    read = readHostEvents({ store, authorize }),
    command = organizationCommand({
      store,
      authorize,
      now: world.clock.now,
      newId: createId,
    });
  const bots = await createBots(sql, [
    'Setup only',
    'Setup and unreleased wording',
  ]);
  const setup = setupCommand({
    store,
    authorize,
    now: world.clock.now,
    newId: createId,
  });
  const [pool] = await sql<
    { id: string }[]
  >`select id from resolution_pools where lobby_id=${lobbyId} order by id limit 1`;
  const [stage] = await sql<
    { id: string }[]
  >`select stage_id id from tab_rounds where id=${world.made.get('tab-round')!}`;
  if (!pool || !stage) throw new Error('Actual event source is missing');
  const text =
    'The unreleased Round should retain this exact authored wording.';
  const [beforeWord] =
    await sql`select version from lobbies where id=${lobbyId}`;
  const added = await setup(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(beforeWord!.version) },
    command: {
      type: 'add-resolution',
      lobbyId,
      pool: { kind: 'existing', poolId: pool.id },
      text,
    },
  });
  const [word] = await sql<
    { id: string; text: string }[]
  >`select id,text from pool_resolutions where pool_id=${pool.id} and text=${text}`;
  if (added.kind !== 'accepted' || !word)
    throw new Error('Actual authored source was not retained');
  const [beforeRound] =
    await sql`select version from lobbies where id=${lobbyId}`;
  const held = await setup(as(world.bots.Director!), {
    version: 1,
    commandId: createId(),
    expected: { lobby: Number(beforeRound!.version) },
    command: {
      type: 'add-tab-round',
      lobbyId,
      stageId: stage.id,
      name: 'Unreleased wording proof',
      resolution: { poolId: pool.id, poolResolutionId: word.id },
    },
  });
  if (held.kind !== 'accepted')
    throw new Error('Actual unreleased Round was not created');
  for (const [index, bot] of bots.entries()) {
    const roleId = createId();
    // The role editor is another slice; actual permission rows are inputs to the canonical grant command.
    await sql`insert into roles(id,organization_id,name,rank,preset) values(${roleId},${organizationId},${bot.name},${55 + index},false)`;
    for (const permission of index === 0
      ? ['lobby.setup.manage']
      : ['lobby.setup.manage', 'tournament.resolutions.read_unreleased'])
      await sql`insert into role_permissions(role_id,organization_id,permission) values(${roleId},${organizationId},${permission})`;
    const [before] = await sql`select version from lobbies where id=${lobbyId}`;
    const granted = await command(as(world.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { lobby: Number(before!.version) },
      command: {
        type: 'give-grant',
        scope: { kind: 'lobby', lobbyId },
        userId: bot.userId,
        roleId,
        expiresAt: null,
      },
    });
    const route = createHostEventsRoute({
      read,
      boundary: {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          ...member,
          principal: { ...as(bot), actorId: bot.actorId },
        }),
      },
      released: async () => true,
    });
    const request = () => new Request(`${origin}${hostEventsPath(lobbyId)}`);
    const response = await route(request()),
      view = hostEventsViewSchema.parse(await response.json());
    const selected = view.resolutionChoices.find(
      (choice) => choice.resolution.poolResolutionId === word.id,
    );
    assert({
      given: `the actual ${bot.name} role at the Events HTTP boundary`,
      should:
        'retain exact source identity while showing wording only to its own unreleased-resolution permission',
      actual: [
        granted.kind,
        response.status,
        selected?.wording?.kind,
        JSON.stringify(view).includes(word.text),
      ],
      expected: [
        'accepted',
        200,
        index === 0 ? 'withheld' : 'shown',
        index === 1,
      ],
    });
    const [grant] =
      await sql`select id from grants where lobby_id=${lobbyId} and user_id=${bot.userId} and revoked_at is null`;
    const [current] =
      await sql`select version from lobbies where id=${lobbyId}`;
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
      given: 'canonical revocation of the only Events grant',
      should: 'conceal the whole authoring read immediately',
      actual: [revoked.kind, (await route(request())).status],
      expected: ['accepted', 404],
    });
  }
}
