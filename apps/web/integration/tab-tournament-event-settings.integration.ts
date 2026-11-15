import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../src/server/test-loggers.test-support';
import {
  createTournamentEventSettingsRoute,
  tournamentEventSettingsPath,
} from '../src/features/tab/tournament-event-settings-route';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readTournamentEventSettings } from '../src/features/tab/reads/tournament-event-settings';
import { settingCommand } from '../src/features/tab/operations/settings';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { storedSetupOf, setupRailOf } from '../src/features/tab/stored-setup';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { Setup } from '../src/ui/tab/setup/setup';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type Bot,
} from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('the host reads actual event setting sources and locks and cannot change an enforced ancestor', async () => {
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
      await leagueConfigurationStage(world);
      await setupStage(world);
      const store = createTabStore(database);
      const send = settingCommand({
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const lobbyId = world.made.get('tournament-lobby')!,
        eventId = world.made.get('event')!,
        organizationId = world.made.get('league')!;
      const changeTemplate = async (command: unknown) => {
        await sql`select set_config('daisy.lobby_scope',${lobbyId},true)`;
        const [event] =
          await sql`select version,settings_version,entries_version from events where id=${eventId}`;
        const answer = await send(as(world.bots.Director!), {
          version: 1,
          commandId: createId(),
          expected: {
            event: Number(event?.version),
            settings: Number(event?.settings_version),
            entries: Number(event?.entries_version),
          },
          command,
        });
        if (answer.kind !== 'accepted')
          throw new Error(`Template setup refused: ${JSON.stringify(answer)}`);
      };
      await changeTemplate({ type: 'stop-following-template', eventId });
      await changeTemplate({
        type: 'follow-template',
        eventId,
        templateId: world.made.get('league-template')!,
      });
      const [organization] =
        await sql`select settings_version from organizations where id=${organizationId}`;
      const enforced = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { settings: Number(organization?.settings_version) },
        command: {
          type: 'set-setting',
          scope: { kind: 'organization', id: organizationId },
          key: 'entry.cap',
          value: { perEvent: 30, perSchool: null },
          hold: 'enforced',
        },
      });
      if (enforced.kind !== 'accepted')
        throw new Error(
          `Ancestor enforcement refused: ${JSON.stringify(enforced)}`,
        );
      await sql`select set_config('daisy.lobby_scope',${lobbyId},true)`;
      const [event] =
        await sql`select settings_version from events where id=${eventId}`;
      const refused = await send(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { settings: Number(event?.settings_version) },
        command: {
          type: 'set-setting',
          scope: { kind: 'event', id: eventId },
          key: 'entry.cap',
          value: { perEvent: 99, perSchool: null },
          hold: 'default',
        },
      });
      assert({
        given: 'a host trying to override the actual enforced organization cap',
        should: 'refuse through the same persisted setting operation',
        actual: refused,
        expected: { kind: 'refused', refusal: 'setting-enforced' },
      });
      const read = readTournamentEventSettings({
        store,
        authorize,
        now: world.clock.now,
      });
      const view = await read(as(world.bots.Director!), { lobbyId, eventId });
      const metadata = await readTournamentSetup({
        store,
        authorize,
        now: world.clock.now,
      })(as(world.bots.Director!), lobbyId);
      if (!view || !metadata)
        throw new Error('The actual setup reads are missing');
      const projected = storedSetupOf(metadata, view, world.clock.now());
      if (!projected) throw new Error('The stored setup projection is missing');
      const html = renderToString(
        createElement(Setup, {
          rail: setupRailOf(metadata),
          setup: projected,
          panel: null,
          pairingForm: null,
        }),
      );
      assert({
        given:
          'the actual persisted setup and followed template, rendered by the existing Setup component',
        should:
          'show its stored event and format, real preset, and real inherited source without sample prose',
        actual: [
          projected.event.current,
          projected.settings.find((line) => line.keys.includes('format'))
            ?.value,
          projected.pairing.summary,
          html.includes(metadata.name),
          html.includes('Southeast League'),
          html.includes('4 prelims, then top 8'),
        ],
        expected: [
          metadata.events[0]!.name,
          `${metadata.events[0]!.format.name} · version ${metadata.events[0]!.format.formatVersion}`,
          'Round 1 is random. Later rounds pair by record (fold).',
          true,
          false,
          false,
        ],
      });
      const cap = view?.settings.find((row) => row.key === 'entry.cap');
      assert({
        given:
          'the actual followed league template and its enforced organization cap',
        should:
          'show the real value, ancestor name and enforced lock after reload',
        actual: cap && {
          value: cap.value,
          source: cap.source,
          locked: cap.locked,
        },
        expected: {
          value: { perEvent: 30, perSchool: null },
          source: {
            kind: 'organization',
            id: organizationId,
            name: 'Valley League',
          },
          locked: 'enforced',
        },
      });
      const origin = 'https://daisy.test';
      const request = () =>
        new Request(
          `${origin}${tournamentEventSettingsPath(lobbyId, eventId)}`,
          { headers: { origin } },
        );
      const get = (person: Bot, released = true) =>
        createTournamentEventSettingsRoute({
          boundary: {
            logger: silentLogger,
            reporter: noopErrorReporter,
            origin: () => origin,
            identify: async () => ({
              state: 'member',
              username: person.name,
              principal: {
                kind: 'user',
                userId: person.userId,
                actorId: person.actorId,
              },
            }),
          },
          released: async () => released,
          read,
        });
      const response = await get(world.bots.Director!)(request());
      assert({
        given: 'the actual event settings through its host HTTP route',
        should:
          'serve the same no-store resolved view and hide non-host or closed-release reads',
        actual: [
          response.status,
          response.headers.get('cache-control'),
          await response.json(),
          (await get(world.bots.Coach!)(request())).status,
          (await get(world.bots.Director!, false)(request())).status,
          (
            await get(
              world.bots.Director!,
              false,
            )(
              new Request(`${origin}/api/tab/tournament-event-settings`, {
                headers: { origin },
              }),
            )
          ).status,
        ],
        expected: [200, 'no-store', view, 404, 404, 404],
      });
      assert({
        given: 'a non-host or an event addressed through a different lobby',
        should: 'return no host settings',
        actual: [
          await read(as(world.bots.Coach!), { lobbyId, eventId }),
          await read(as(world.bots.Director!), {
            lobbyId: world.made.get('standing-lobby')!,
            eventId,
          }),
        ],
        expected: [null, null],
      });
    },
  });
});
