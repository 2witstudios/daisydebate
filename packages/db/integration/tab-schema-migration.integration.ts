import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, test } from 'riteway/bun';
import { daisyOrganizationId, publicLobbyId } from '../src/daisy-reference';
import { withFixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl: url } = integrationSuite();

const schema = '20261114051015_tab_schema';
const validated = '20261114051016_tab_schema_checks_validated';
const scratch = scratchDatabase(url, 'tabschema');
afterAll(() => scratch.drop());

const checks = [
  'ballots_ballot_definition_complete',
  'formats_one_owner_at_most',
  'rooms_ballot_definition_complete',
  'rooms_event_is_casual',
  'rooms_host_by_lobby_kind',
] as const;

const validity = async (sql: SQL) =>
  Object.fromEntries(
    (
      (await sql`select conname, convalidated from pg_constraint
        where conname in ${sql([...checks])} order by conname`) as Array<{
        conname: string;
        convalidated: boolean;
      }>
    ).map((row) => [row.conname, row.convalidated]),
  );

/**
 * The seeded proof for the two tab schema folders: the tables they alter
 * hold rows on every deployed database, and CI migrates only empty ones.
 */
test(
  'the tab schema migrates a database that already holds Rooms, seasons and ratings',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < schema);
    await withFixture(scratch.url, async (fixture) => {
      const host = await fixture.actor();
      const roomId = await fixture.room(host, await fixture.format());
      const seasonId = createId();
      await fixture.insert('seasons', {
        id: seasonId,
        name: 'Season before lobbies',
        starts_at: new Date('2026-10-01T00:00:00.000Z'),
        status: 'active',
      });
      await fixture.insert(
        'ratings',
        {
          actor_id: host,
          season_id: seasonId,
          ladder: 'policy',
          rating: 1500,
          deviation: 350,
          volatility: 0.06,
        },
        'actor_id',
      );
      await scratch.migrate((folder) => folder <= schema);
      const afterSchema = await validity(fixture.sql);
      await scratch.migrate((folder) => folder <= validated);
      const [room] = await fixture.sql`
        select lobby_id, lobby_kind, host_actor_id = ${host} as keeps_host, template_id
        from rooms where id = ${roomId}`;
      const [season] = await fixture.sql`
        select organization_id from seasons where id = ${seasonId}`;
      const [rating] = await fixture.sql`
        select l.lobby_id, l.organization_id from ratings r
        join ladders l on l.id = r.ladder where r.actor_id = ${host}`;
      assert({
        given:
          'a Room, an active season and a rating stored before the tab schema, then both folders applied',
        should:
          "put the Room in Daisy's public lobby with its host, make the season Daisy's, resolve the rating's ladder, and end with every new CHECK validated",
        actual: {
          room,
          season,
          rating,
          afterSchema,
          afterValidation: await validity(fixture.sql),
        },
        expected: {
          room: {
            lobby_id: publicLobbyId,
            lobby_kind: 'standing',
            keeps_host: true,
            template_id: null,
          },
          season: { organization_id: daisyOrganizationId },
          rating: {
            lobby_id: publicLobbyId,
            organization_id: daisyOrganizationId,
          },
          afterSchema: Object.fromEntries(checks.map((name) => [name, false])),
          afterValidation: Object.fromEntries(
            checks.map((name) => [name, true]),
          ),
        },
      });
    });
  },
  ddlTimeoutMs,
);
