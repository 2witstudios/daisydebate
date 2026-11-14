import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { settingCommand } from '../src/features/tab/operations/settings';
import { organizationStage } from './tab-tournament-organization.test-support';
import { leagueAdministrationStage } from './tab-tournament-league-administration.test-support';
import {
  as,
  deniedAsNotFound,
} from './tab-tournament-organization-wiring.test-support';
import { createBots, scriptClock } from './tab-tournament.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
test('settings and offers follow their stored chain', async () => {
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
      const director = world.bots.Director!;
      const coach = world.bots.Coach!;
      const organizationId = world.made.get('league')!;
      const lobbyId = world.made.get('standing-lobby')!;
      const send = settingCommand({
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const set = {
        version: 1,
        commandId: createId(),
        expected: { settings: 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'organization', id: organizationId },
          key: 'room.visibility',
          value: { value: 'unlisted' },
          hold: 'enforced',
        },
      };
      assert({
        given: 'a member with no management grant',
        should: 'deny setting the league policy',
        actual: await deniedAsNotFound(() => send(as(coach), set)),
        expected: true,
      });
      const enforced = await send(as(director), set);
      assert({
        given: 'the league owner',
        should: 'persist its enforced setting',
        actual: enforced.kind,
        expected: 'accepted',
      });
      const refused = await send(as(director), {
        version: 1,
        commandId: createId(),
        expected: { settings: 1 },
        command: {
          type: 'set-setting',
          scope: { kind: 'lobby', id: lobbyId },
          key: 'room.visibility',
          value: { value: 'public' },
          hold: 'default',
        },
      });
      assert({
        given: 'a lobby below the enforced organization setting',
        should: 'refuse a local change',
        actual: refused,
        expected: { kind: 'refused', refusal: 'setting-enforced' },
      });
      const offer = await send(as(director), {
        version: 1,
        commandId: createId(),
        expected: { lobby: 2 },
        command: {
          type: 'offer-template',
          lobbyId,
          templateId: 's3tw1srulgcs6y2xhbog8gps',
        },
      });
      assert({
        given: 'a standing lobby offering a Daisy template',
        should: 'store the offer',
        actual: offer.kind,
        expected: 'accepted',
      });
      const stored =
        await sql`select key, hold, value from settings where scope_kind = 'organization' and organization_id = ${organizationId}`;
      assert({
        given: 'the policy after a refused override',
        should: 'retain only the original enforced value',
        actual: stored.map(
          (row: { key: string; hold: string; value: unknown }) => ({ ...row }),
        ),
        expected: [
          {
            key: 'room.visibility',
            hold: 'enforced',
            value: { value: 'unlisted' },
          },
        ],
      });
    },
  });
});
