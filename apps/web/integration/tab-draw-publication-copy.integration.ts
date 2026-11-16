import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { setupRitewayBun, test } from 'riteway/bun';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { preparePublication } from './tab-publication-setup.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('publishing a copy template assembles actual event Rooms once without a host or fabricated readiness', async () => {
  await withRolledBackDatabase(databaseUrl, {
    seed: (sql) =>
      createBots(sql, [
        'Director',
        'Staff',
        'Coach',
        'Judge A',
        'Judge B',
        'Judge C',
        'Debater 1',
        'Debater 2',
        'Debater 3',
        'Debater 4',
      ]),
    work: async (database, bots, sql) => {
      const world = {
        database,
        sql,
        bots: Object.fromEntries(bots.map((bot) => [bot.name, bot])),
        clock: scriptClock(),
        made: new Map<string, string>(),
      };
      await preparePublication(world, 'copy');
      await publishDrawStage(world);
    },
  });
});
