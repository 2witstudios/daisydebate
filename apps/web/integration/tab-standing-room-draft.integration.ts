import { createId } from '@paralleldrive/cuid2';
import { settingCommand } from '../src/features/tab/operations/settings';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { leagueConfigurationStage } from './tab-tournament-league-configuration.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import { readStandingRoomDraft } from '../src/features/tab/reads/standing-room-draft';
import { createBots, scriptClock } from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('the standing Room read loads only its offered chain and evaluates after facts load', async () => {
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
      const store = createTabStore(database);
      const input = {
        viewerUserId: world.bots.Coach!.userId,
        lobbyId: world.made.get('standing-lobby')!,
      };
      const facts = await store.standingRoomDraft(
        input,
        async (facts) => facts,
      );
      assert({
        given:
          'other seeded organizations and templates outside the offered standing chain',
        should: 'load only this actual owner and offered template',
        actual: {
          organizations: facts?.graph.organizations.map((row) => row.id),
          templates: facts?.graph.templates.map((row) => row.id),
        },
        expected: {
          organizations: [world.made.get('league')!],
          templates: [world.made.get('league-template')!],
        },
      });
      const draft = await readStandingRoomDraft({
        store,
        authorize,
        now: world.clock.now,
      })(as(world.bots.Coach!), {
        lobbyId: input.lobbyId,
        templateId: world.made.get('league-template')!,
      });
      assert({
        given: 'the bounded stored chain',
        should: 'retain the actual offered format and settings projection',
        actual: draft?.templates.map((row) => row.templateId),
        expected: [world.made.get('league-template')!],
      });
      const [external] =
        await sql`select id,organization_id from templates where organization_id <> ${world.made.get('league')!} and format_id='freestyle' limit 1`;
      if (!external) throw new Error('Seeded shared template is missing');
      const [lobby] =
        await sql`select version from lobbies where id=${input.lobbyId}`;
      const offered = await settingCommand({
        store,
        authorize,
        now: world.clock.now,
        newId: createId,
      })(as(world.bots.Director!), {
        version: 1,
        commandId: createId(),
        expected: { lobby: Number(lobby?.version) },
        command: {
          type: 'offer-template',
          lobbyId: input.lobbyId,
          templateId: String(external.id),
        },
      });
      if (offered.kind !== 'accepted')
        throw new Error(`External offer refused: ${JSON.stringify(offered)}`);
      const followed = await store.standingRoomDraft(
        input,
        async (facts) => facts,
      );
      assert({
        given: 'an actual offered template owned by another organization',
        should:
          'reach that verified owner and template without including its unoffered siblings',
        actual: {
          organizations: followed?.graph.organizations
            .map((row) => row.id)
            .sort(),
          templates: followed?.graph.templates.map((row) => row.id).sort(),
        },
        expected: {
          organizations: [
            world.made.get('league')!,
            String(external.organization_id),
          ].sort(),
          templates: [
            world.made.get('league-template')!,
            String(external.id),
          ].sort(),
        },
      });
    },
  });
});
