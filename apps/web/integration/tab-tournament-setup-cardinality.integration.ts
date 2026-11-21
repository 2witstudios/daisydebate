import { sanctionLines } from '../src/features/tab/setup';
import { SettingRow } from '../src/ui/tab/setting-row/setting-row';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Setup } from '../src/ui/tab/setup/setup';
import { linkTo } from '../src/features/tab/action';
import { hostRoutes } from '../src/features/tab/routes';
import { createOwnedEvent } from './tab-tournament-owned-event.test-support';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { organizationCommand } from '../src/features/tab/operations/organization';
import { lobbyAdministrationCommand } from '../src/features/tab/operations/lobby-administration';
import { settingCommand } from '../src/features/tab/operations/settings';
import { setupCommand } from '../src/features/tab/operations/setup';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('a real zero-event setup is readable without inventing its first event', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      const store = createTabStore(database),
        common = { store, authorize, now: world.clock.now, newId: createId };
      const created = await lobbyAdministrationCommand({
        ...common,
      })(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-lobby',
          owner: {
            kind: 'organization',
            organizationId: world.made.get('league')!,
          },
          name: 'Empty tournament',
          handle: `empty-${createId()}`,
          lobby: { kind: 'tournament', admitsMinors: false },
        },
      });
      if (created.kind !== 'accepted')
        throw new Error('Empty tournament refused');
      const read = readTournamentSetup(common),
        lobbyId = created.receipt.aggregate.id;
      const view = await read(as(world.bots.Director!), lobbyId);
      assert({
        given:
          'the actual newly created tournament before any add-event command',
        should:
          'return its real empty setup rather than hiding it or fabricating an event',
        actual: view && {
          id: view.lobbyId,
          name: view.name,
          status: view.status,
          events: view.events,
          slots: view.timeSlots,
          pools: view.resolutionPools,
        },
        expected: {
          id: lobbyId,
          name: 'Empty tournament',
          status: 'draft',
          events: [],
          slots: [],
          pools: [],
        },
      });
      if (!view) throw new Error('The actual empty setup is missing');
      const eventsHref = hostRoutes.events(view.handle);
      const html = renderToString(
        createElement(Setup, {
          rail: {
            title: view.name,
            subtitle: null,
            heading: null,
            items: [],
            footHeading: null,
            foot: [],
          },
          empty: { addEvent: linkTo('Add an event', eventsHref) },
        }),
      );
      assert({
        given:
          'the actual zero-event host read rendered by the existing setup screen',
        should:
          'show the real empty state and setup navigation without a sample event',
        actual: [
          html.includes('No events yet.'),
          html.includes(view.name),
          html.includes(eventsHref),
          html.includes('Varsity'),
        ],
        expected: [true, true, true, false],
      });
      const added = await setupCommand(common)(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { lobby: 1 },
        command: {
          type: 'add-event',
          lobbyId,
          name: 'Actual first event',
          label: 'FIRST',
          entry: { kind: 'person' },
          pin: {
            kind: 'format',
            formatId: 'freestyle',
            formatVersion: 1,
            ballotDefinition: null,
          },
        },
      });
      if (added.kind !== 'accepted') throw new Error('First event refused');
      assert({
        given: 'the actual subsequent first-event command',
        should: 'show only that persisted event on reload',
        actual: (await read(as(world.bots.Director!), lobbyId))?.events.map(
          (row) => row.name,
        ),
        expected: ['Actual first event'],
      });
    },
  });
});
test('host setup exposes every actual authorized sanction without another lobby record', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach', 'Judge A']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      await setupStage(world);
      const store = createTabStore(database),
        common = { store, authorize, now: world.clock.now, newId: createId };
      const assets = [];
      for (const name of [
        'First sanctioning league',
        'Second sanctioning league',
      ]) {
        const organization = await organizationCommand({
          ...common,
        })(as(world.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-organization',
            kind: 'league',
            name,
            handle: `sanction-${createId()}`,
          },
        });
        if (organization.kind !== 'accepted')
          throw new Error('Sanction league refused');
        const organizationId = organization.receipt.aggregate.id;
        const template = await settingCommand(common)(
          as(world.bots.Director!),
          {
            version: 1,
            commandId: createId(),
            expected: {},
            command: {
              type: 'create-template',
              organizationId,
              name: `${name} template`,
              format: { id: 'freestyle', version: 1 },
              ballotDefinition: null,
            },
          },
        );
        if (template.kind !== 'accepted')
          throw new Error('Sanction template refused');
        const standing = await lobbyAdministrationCommand(common)(
          as(world.bots.Director!),
          {
            version: 1,
            commandId: createId(),
            expected: {},
            command: {
              type: 'create-lobby',
              owner: { kind: 'organization', organizationId: organizationId },
              name: 'Standing lobby',
              handle: `standing-${createId()}`,
              lobby: { kind: 'standing' },
            },
          },
        );
        if (standing.kind !== 'accepted')
          throw new Error('Standing lobby refused');
        const season = await lobbyAdministrationCommand({
          ...common,
        })(as(world.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: {},
          command: {
            type: 'create-season',
            organizationId,
            lobbyId: standing.receipt.aggregate.id,
            name: 'Current season',
            startsAt: world.clock.now(),
            endsAt: null,
            counting: 'sanction',
            countsLobbyRooms: false,
            rule: {},
          },
        });
        if (season.kind !== 'accepted')
          throw new Error('Sanction season refused');
        assets.push({
          organizationId,
          templateId: template.receipt.aggregate.id,
          seasonId: season.receipt.aggregate.id,
          name,
        });
      }
      const lobbyId = world.made.get('tournament-lobby')!,
        eventId = world.made.get('event')!;
      // Existing pending request data only; this is not proof of a wired sanction command.
      await sql`select set_config('daisy.lobby_scope',${lobbyId},true)`;
      for (const asset of assets)
        await sql`insert into sanctions(id,organization_id,lobby_id,event_id,season_id,template_id,status,created_at) values(${createId()},${asset.organizationId},${lobbyId},${eventId},${asset.seasonId},${asset.templateId},'requested',${new Date(world.clock.now())})`;
      const elsewhere = await createOwnedEvent(world);
      const unrelated = assets[0]!;
      await sql`select set_config('daisy.lobby_scope', ${elsewhere.lobbyId}, true)`;
      await sql`insert into sanctions(id,organization_id,lobby_id,event_id,season_id,template_id,status,created_at) values(${createId()},${unrelated.organizationId},${elsewhere.lobbyId},${elsewhere.eventId},${unrelated.seasonId},${unrelated.templateId},'requested',${new Date(world.clock.now())})`;
      const read = readTournamentSetup(common);
      const view = await read(as(world.bots.Director!), lobbyId);
      assert({
        given:
          'two actual pending sanction records from distinct real leagues on the same event',
        should: 'return both authorized records without choosing one league',
        actual: view?.events
          .find((row) => row.eventId === eventId)
          ?.sanctions?.map((row) => [
            row.organization.organizationId,
            row.organization.name,
            row.status,
          ])
          .sort(),
        expected: assets
          .map((asset) => [asset.organizationId, asset.name, 'requested'])
          .sort(),
      });
      const eventView = view?.events.find((row) => row.eventId === eventId);
      if (!view || !eventView)
        throw new Error('Actual multi-sanction setup missing');
      const lines = sanctionLines(
        { subject: 'sanction', label: 'Counts for' },
        eventView,
        { scope: 'lobby', name: view.name },
        world.clock.now(),
      );
      const html = renderToString(
        createElement(
          'ul',
          null,
          ...lines.map((line) =>
            createElement(SettingRow, { key: line.id, setting: line }),
          ),
        ),
      );
      assert({
        given:
          'the actual two authorized sanction records projected for the existing setup screen',
        should:
          'retain distinct stable organization identities and display both leagues once',
        actual: {
          rows: lines.map((line) => [line.id, line.value]).sort(),
          displayed: assets.map((asset) => html.split(asset.name).length - 1),
        },
        expected: {
          rows: assets
            .map((asset) => [asset.organizationId, asset.name])
            .sort(),
          displayed: [1, 1],
        },
      });
      const inactive = sanctionLines(
        { subject: 'sanction', label: 'Counts for' },
        {
          ...eventView,
          sanctions: eventView.sanctions.map((row, index) => ({
            ...row,
            status: index === 0 ? 'declined' : 'withdrawn',
          })),
        },
        { scope: 'lobby', name: view.name },
        world.clock.now(),
      );
      assert({
        given:
          'declined and withdrawn authorized sanction rows in the setup presentation',
        should: 'never describe those leagues as currently counting the result',
        actual: inactive.map((row) => row.attention),
        expected: [
          'Does not count · sanction declined',
          'Does not count · sanction withdrawn',
        ],
      });
      assert({
        given: 'an actual non-host asking for the same sanction metadata',
        should: 'return no host setup',
        actual: await read(as(world.bots.Coach!), lobbyId),
        expected: null,
      });
    },
  });
});
