import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('tournament setup persists its structure and settings', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) => createBots(sql, ['Director', 'Staff', 'Coach']),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        clock: scriptClock(),
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        made: new Map<string, string>(),
      };
      await organizationStage(world);
      await leagueAdministrationStage(world);
      await setupStage(world);
    },
  });
});
