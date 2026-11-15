import { requireTestServices } from '@daisy/config';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createBots, scriptClock } from './tab-tournament.test-support';
import { preparePublication } from './tab-publication-setup.test-support';
import { publishDrawStage } from './tab-tournament-publication.test-support';
import { copyForeignBallot } from './tab-copied-ballot.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
for (const mode of ['copy', 'detach'] as const)
  test(`foreign ballot ${mode} retains source ownership through actual host read and draw publication`, async () => {
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
        await preparePublication(world, 'follow', async () => {
          await copyForeignBallot(world, mode);
        });
        await publishDrawStage(world);
        const rooms =
          await sql`select r.ballot_definition_id,r.ballot_definition_version,r.template_id,r.host_actor_id from rooms r join fixtures f on f.room_id=r.id where f.tab_round_id=${world.made.get('tab-round')!} order by r.id`;
        assert({
          given: 'actual published Rooms of the copied event',
          should:
            'pin their owned immutable source without fake offers or a host identity',
          actual: rooms,
          expected: Array.from({ length: 2 }, () => ({
            ballot_definition_id: world.made.get('copied-ballot')!,
            ballot_definition_version: 1,
            template_id: null,
            host_actor_id: null,
          })),
        });
      },
    });
  });
