import { noopErrorReporter } from '@daisy/observability';
import { silentLogger } from '../src/server/test-loggers.test-support';
import {
  createTournamentSetupRoute,
  tournamentSetupPath,
} from '../src/features/tab/tournament-setup-route';
import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { readTournamentSetup } from '../src/features/tab/reads/tournament-setup';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import { setupStage } from './tab-tournament-setup.test-support';
import { as } from './tab-tournament-organization-wiring.test-support';
import {
  createBots,
  scriptClock,
  type Bot,
} from './tab-tournament.test-support';
setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('the host reads actual tournament setup pins and schedule without any resolution text', async () => {
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
      const store = createTabStore(database);
      const read = readTournamentSetup({
        store,
        authorize,
        now: world.clock.now,
      });
      const lobbyId = world.made.get('tournament-lobby')!;
      const view = await read(as(world.bots.Director!), lobbyId);
      assert({
        given: 'an actual owner and the setup created through real commands',
        should:
          'read the actual pinned event, stage, round, slot and pool size',
        actual: view && {
          lobbyId: view.lobbyId,
          events: view.events.map((row) => ({
            id: row.eventId,
            name: row.name,
            format: row.format.formatId,
            version: row.format.formatVersion,
            template: row.template?.templateId,
            stages: row.stages.map((stage) => [
              stage.kind,
              stage.timing,
              stage.place,
            ]),
            rounds: row.tabRounds.map((round) => [
              round.tabRoundId,
              round.timeSlotId,
            ]),
          })),
          slots: view.timeSlots.map((slot) => slot.timeSlotId),
          pools: view.resolutionPools.map((pool) => [pool.name, pool.size]),
          manage: view.capabilities.manage,
        },
        expected: {
          lobbyId,
          events: [
            {
              id: world.made.get('event')!,
              name: 'Varsity',
              format: 'freestyle',
              version: 1,
              template: 's3tw1srulgcs6y2xhbog8gps',
              stages: [['preliminary', 'live', 'online']],
              rounds: [
                [world.made.get('tab-round')!, world.made.get('time-slot')!],
              ],
            },
          ],
          slots: [world.made.get('time-slot')!],
          pools: [['Spring resolutions', 1]],
          manage: true,
        },
      });
      const [address] =
        await sql`select handle from lobbies where id=${lobbyId}`;
      const origin = 'https://daisy.test';
      const request = (handle = String(address?.handle)) =>
        new Request(`${origin}${tournamentSetupPath(handle)}`, {
          headers: { origin },
        });
      const get = (person: Bot, released = true) =>
        createTournamentSetupRoute({
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
          lobbyIdOfHandle: store.lobbyIdOfHandle,
          read,
        });
      const response = await get(world.bots.Director!)(request());
      assert({
        given:
          'the closed-release HTTP read enabled only in this real-service proof',
        should:
          'resolve the actual handle and serve the same no-store host view',
        actual: [
          response.status,
          response.headers.get('cache-control'),
          await response.json(),
        ],
        expected: [200, 'no-store', view],
      });
      assert({
        given:
          'a non-host, a closed release and an unknown handle through HTTP',
        should: 'answer every refusal as not found',
        actual: [
          (await get(world.bots.Coach!)(request())).status,
          (await get(world.bots.Director!, false)(request())).status,
          (await get(world.bots.Director!)(request(`absent-${createId()}`)))
            .status,
        ],
        expected: [404, 404, 404],
      });
      assert({
        given: 'the same host read and an actual stored resolution',
        should: 'never put the resolution wording into setup',
        actual: JSON.stringify(view).includes(
          'Public libraries should receive more funding.',
        ),
        expected: false,
      });
      assert({
        given: 'a non-host member, an unknown address, and a standing lobby',
        should: 'return no tournament host setup',
        actual: [
          await read(as(world.bots.Coach!), lobbyId),
          await read(as(world.bots.Director!), createId()),
          await read(
            as(world.bots.Director!),
            world.made.get('standing-lobby')!,
          ),
        ],
        expected: [null, null, null],
      });
    },
  });
});
