import { authorize } from '@daisy/auth/authorization';
import { requireTestServices } from '@daisy/config';
import { createTabStore } from '@daisy/db/tab';
import { withRolledBackDatabase } from '@daisy/db/testing';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { setupCommand } from '../src/features/tab/operations/setup';
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
      const template = await send(as(director), {
        version: 1,
        commandId: createId(),
        expected: {},
        command: {
          type: 'create-template',
          organizationId,
          name: 'League freestyle',
          format: { id: 'freestyle', version: 1 },
          ballotDefinition: null,
        },
      });
      assert({
        given: 'the real standard format identifier',
        should: 'pin a league template',
        actual: template.kind,
        expected: 'accepted',
      });
      const [pin] =
        await sql`select format_id, format_version from templates where organization_id = ${organizationId} and name = 'League freestyle'`;
      assert({
        given: 'the new league template after reload',
        should: 'retain the standard format pin',
        actual: pin ? [pin.format_id, pin.format_version] : null,
        expected: ['freestyle', 1],
      });
      const setup = setupCommand({
        store: createTabStore(database),
        authorize,
        now: world.clock.now,
        newId: createId,
      });
      const poolCommand = {
        version: 1,
        commandId: createId(),
        expected: { lobby: 3 },
        command: {
          type: 'add-resolution',
          lobbyId,
          pool: { kind: 'new', name: 'League topics' },
          text: 'Resolved: this is the league topic.',
        },
      };
      assert({
        given: 'a member without host authority',
        should: 'deny resolution pool writes',
        actual: await deniedAsNotFound(() => setup(as(coach), poolCommand)),
        expected: true,
      });
      const pooled = await setup(as(director), poolCommand);
      assert({
        given: 'a standing lobby host',
        should: 'add a resolution and replay it',
        actual: [pooled.kind, await setup(as(director), poolCommand)],
        expected: [
          'accepted',
          pooled.kind === 'accepted'
            ? { ...pooled, receipt: { ...pooled.receipt, replayed: true } }
            : pooled,
        ],
      });
      const [resolution] =
        await sql`select r.id, r.text from pool_resolutions r join resolution_pools p on p.id = r.pool_id where p.lobby_id = ${lobbyId} and p.name = 'League topics'`;
      assert({
        given: 'the standing pool after reload',
        should: 'retain its actual resolution',
        actual: resolution?.text,
        expected: 'Resolved: this is the league topic.',
      });
      const retired = await setup(as(director), {
        version: 1,
        commandId: createId(),
        expected: { lobby: 4 },
        command: {
          type: 'retire-resolution',
          lobbyId,
          poolResolutionId: String(resolution?.id),
        },
      });
      assert({
        given: 'an unused standing lobby resolution',
        should: 'retire it',
        actual: retired.kind,
        expected: 'accepted',
      });
      const tournamentOnly = await setup(as(director), {
        version: 1,
        commandId: createId(),
        expected: { lobby: 5 },
        command: {
          type: 'add-time-slot',
          lobbyId,
          name: 'Must stay tournament only',
          startsAt: world.clock.now(),
        },
      });
      assert({
        given: 'a standing lobby',
        should: 'keep tournament setup closed',
        actual: tournamentOnly,
        expected: { kind: 'refused', refusal: 'lobby-not-tournament' },
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
