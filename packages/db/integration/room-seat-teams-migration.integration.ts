import { afterAll } from 'bun:test';
import { requireTestServices } from '@daisy/config';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { Fixture } from './constraint-helpers';
import {
  ddlTimeoutMs,
  scratchDatabase,
} from './scratch-migrations.test-support';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);
const seatTeams = '20261116205542_room_seat_teams';
const scratch = scratchDatabase(databaseUrl, 'seatteams');
afterAll(() => scratch.drop());

test(
  'existing casual Rooms keep their sides and ranked open Rooms keep the flip (ADR 0143)',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < seatTeams);
    const client = new SQL(scratch.url);
    const f = new Fixture(client);
    try {
      const formatId = await f.format();
      const assembling = await f.room(await f.actor(), formatId);
      const closed = await f.room(await f.actor(), formatId, {
        status: 'closed',
      });
      await f.preset(formatId);
      const ranked = await f.room(await f.actor(), formatId, {
        competition_type: 'ranked',
        preset_version: 1,
      });
      await scratch.migrate((folder) => folder <= seatTeams);
      const side = async (id: string) => {
        const [row] =
          await client`select team_one_side from rooms where id=${id}`;
        return row ? row.team_one_side : 'missing';
      };
      const refused = await client`update rooms set team_one_side='affirmative'
        where id=${ranked}`.then(
        () => 'accepted',
        (error: { constraint?: string }) => error.constraint,
      );
      assert({
        given:
          'an assembling and a closed casual Room and an assembling ranked Room from before the migration, then a fixed side written on the ranked one',
        should:
          'fix team 1 on Affirmative for the casual Rooms, keep the ranked one on the flip, and refuse fixing it',
        actual: [
          await side(assembling),
          await side(closed),
          await side(ranked),
          refused,
        ],
        expected: [
          'affirmative',
          'affirmative',
          null,
          'rooms_ranked_sides_open_check',
        ],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
