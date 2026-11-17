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
  'existing Rooms keep the sides their seats were taken for (ADR 0143)',
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
      await scratch.migrate((folder) => folder <= seatTeams);
      const rows = await client`select id, team_one_side from rooms
        where id in (${assembling}, ${closed}) order by id`;
      assert({
        given: 'an assembling and a closed Room from before the migration',
        should: 'fix team 1 on Affirmative for both, so no Room flips',
        actual: rows.map((row: { team_one_side: string }) => row.team_one_side),
        expected: ['affirmative', 'affirmative'],
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
