import { nativeRoomCases } from './lobby-room-create-cases.test-support';
import { settingCommand } from '../src/features/tab/operations/settings';
import { createLobbyCommandRoute } from '../src/features/tab/lobby-command-route';
import { member, origin } from '../src/server/member-boundary.test-support';
import { silentLogger } from '../src/server/test-loggers.test-support';
import { noopErrorReporter } from '@daisy/observability';
import { lobbySetupCommandEnvelopeSchema } from '@daisy/protocol/lobby/lobby-setup-command';
import { requireTestServices } from '@daisy/config';
import {
  scratchDatabase,
  committingRuntimeTestDatabase,
} from '@daisy/db/testing';
import { createTabStore } from '@daisy/db/tab';
import { authorize } from '@daisy/auth/authorization';
import { createId } from '@paralleldrive/cuid2';
import { SQL } from 'bun';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createLobbyRoom } from '../src/features/tab/operations/create-lobby-room';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import {
  createBots,
  scriptClock,
  type World,
} from './tab-tournament.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('a member creates a standing lobby Room through its Tab command', async () => {
  const scratch = scratchDatabase(databaseUrl, 'lobbyroomcreate');
  await scratch.create();
  const owner = new SQL(scratch.url, { max: 4 });
  try {
    await scratch.migrate(() => true);
    const bots = await createBots(owner, [
      'Director',
      'Staff',
      'Coach',
      'Judge A',
      'Debater 1',
      'Debater 2',
    ]);
    const world: World = {
      database: committingRuntimeTestDatabase(owner),
      sql: owner,
      runtimeDatabaseUrl: scratch.url,
      clock: scriptClock(),
      bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
      made: new Map(),
    };
    await organizationStage(world);
    await leagueAdministrationStage(world);
    await leagueConfigurationStage(world);
    const store = createTabStore(world.database);
    const read = readStandingRoomDraft({
      store,
      authorize,
      now: world.clock.now,
    });
    const lobbyId = world.made.get('standing-lobby')!;
    const templateId = world.made.get('league-template')!;
    const [standing] =
      await owner`select handle,settings_version from lobbies where id=${lobbyId}`;
    const [organization] =
      await owner`select handle from organizations where id=${world.made.get('league')!}`;
    assert({
      given:
        'distinct organization and standing lobby handles with no active season',
      should:
        'resolve only actual standing identity without an organization alias or season requirement',
      actual: [
        standing!.handle !== organization!.handle,
        await store.standingLobbyAddressOfHandle(String(standing!.handle)),
        await store.standingLobbyAddressOfHandle(String(organization!.handle)),
        await store.standingLobbyIdOfOrganization(world.made.get('league')!),
        (
          await owner`select count(*)::int n from seasons where organization_id=${world.made.get('league')!} and status='active'`
        )[0]!.n,
      ],
      expected: [
        true,
        { lobbyId, organizationId: world.made.get('league')! },
        null,
        lobbyId,
        0,
      ],
    });
    const [ladder] =
      await owner`select id from ladders where lobby_id=${lobbyId}`;
    const selected = await settingCommand({
      store,
      authorize,
      now: world.clock.now,
      newId: createId,
    })(as(world.bots.Director!), {
      version: 1,
      commandId: createId(),
      expected: { settings: Number(standing!.settings_version) },
      command: {
        type: 'set-setting',
        scope: { kind: 'lobby', id: lobbyId },
        key: 'standings.rating_ladder',
        value: { ladderId: String(ladder!.id) },
        hold: 'default',
      },
    });
    if (selected.kind !== 'accepted')
      throw new Error('native rating selection refused');
    const loaded = await read(as(world.bots.Coach!), { lobbyId, templateId });
    if (!loaded?.creation) throw new Error('real create metadata missing');
    const commandId = createId();
    const body = {
      version: 1,
      commandId,
      expected: {},
      command: {
        type: 'create-lobby-room',
        lobbyId,
        templateId,
        config: loaded.creation.config,
        room: {
          commandId,
          title: 'A member lobby Room',
          visibility: 'unlisted',
          selection: loaded.creation.selection,
          resolution: {
            kind: 'custom',
            text: 'A real member-selected resolution.',
          },
        },
      },
    };
    const send = createLobbyRoom({
      store,
      authorize,
      now: world.clock.now,
      newId: createId,
    });
    const created = await send(as(world.bots.Coach!), body);
    assert({
      given: 'an admitted active league member with no host grant',
      should: 'create one canonical Room and one Tab receipt',
      actual: created.kind,
      expected: 'accepted',
    });
    if (created.kind !== 'accepted') throw new Error(JSON.stringify(created));
    assert({
      given: 'a lost response retried with the same envelope',
      should: 'replay the same aggregate without another Room',
      actual: await send(as(world.bots.Coach!), body),
      expected: { ...created, receipt: { ...created.receipt, replayed: true } },
    });
    assert({
      given: 'an outsider knowing all source ids',
      should: 'deny creation without inserting a Room',
      actual: await deniedAsNotFound(() =>
        send(as(world.bots['Judge A']!), {
          ...body,
          commandId,
          command: {
            ...body.command,
            room: { ...body.command.room, commandId },
          },
        }),
      ),
      expected: true,
    });
    const http = createLobbyCommandRoute({
      store,
      authorize,
      now: world.clock.now,
      newId: createId,
      boundary: {
        logger: silentLogger,
        reporter: noopErrorReporter,
        origin: () => origin,
        identify: async () => ({
          ...member,
          principal: {
            ...as(world.bots.Coach!),
            actorId: world.bots.Coach!.actorId,
          },
        }),
      },
      released: async () => true,
    });
    const httpId = createId();
    const response = await http(
      new Request(`${origin}/api/tab/lobby-command`, {
        method: 'POST',
        headers: { origin, 'content-type': 'application/json' },
        body: JSON.stringify({
          ...body,
          commandId: httpId,
          command: {
            ...body.command,
            room: {
              ...body.command.room,
              commandId: httpId,
              title: 'Native HTTP create',
            },
          },
        }),
      }),
    );
    assert({
      given:
        'the existing lobby-command HTTP route and canonical native payload',
      should: 'dispatch create-lobby-room rather than tournament setup',
      actual: [
        response.status,
        ((await response.json()) as { kind: string }).kind,
        response.headers.get('cache-control'),
      ],
      expected: [200, 'accepted', 'no-store'],
    });
    const validated = lobbySetupCommandEnvelopeSchema.parse(body);
    if (validated.command.type !== 'create-lobby-room')
      throw new Error('create payload missing');
    await nativeRoomCases(
      world,
      validated.command,
      created.receipt.aggregate.id,
    );
    const rows =
      await owner`select r.id,r.lobby_id,r.template_id,r.visibility,r.host_actor_id,h.actor_user_id,h.type from rooms r join action_history h on h.aggregate_id=r.id where r.id=${created.receipt.aggregate.id}`;
    assert({
      given: 'the committed create',
      should: 'retain actual parent pins, host identity and audited command',
      actual: rows.map((row: Record<string, unknown>) => [
        row.lobby_id,
        row.template_id,
        row.visibility,
        row.host_actor_id,
        row.actor_user_id,
        row.type,
      ]),
      expected: [
        [
          lobbyId,
          templateId,
          'unlisted',
          world.bots.Coach!.actorId,
          world.bots.Coach!.userId,
          'create-lobby-room',
        ],
      ],
    });
  } finally {
    await owner.close();
    await scratch.drop();
  }
}, 90_000);
