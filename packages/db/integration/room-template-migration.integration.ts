import { afterAll } from 'bun:test';
import { SQL } from 'bun';
import { assert, test } from 'riteway/bun';
import { publicLobbyId } from '../src/daisy-reference';
import { Fixture } from './constraint-helpers';
import {
  scratchDatabase,
  ddlTimeoutMs,
} from './scratch-migrations.test-support';
import { integrationSuite } from './suite.test-support';

const { databaseUrl } = integrationSuite();
const scratch = scratchDatabase(databaseUrl, 'roomtemplate');
const migration = '20261117033256_tab_wiring';
afterAll(() => scratch.drop());

test(
  'DEC403: existing standing template pins and offers survive the forward migration',
  async () => {
    await scratch.create();
    await scratch.migrate((folder) => folder < migration);
    const client = new SQL(scratch.url, { max: 1 });
    try {
      const fixture = new Fixture(client);
      const host = await fixture.actor();
      const [offer] = await client`
        select t.id, t.format_id, t.format_version from templates t
        join lobby_templates o on o.template_id=t.id
        where o.lobby_id=${publicLobbyId} and t.format_id='freestyle'`;
      if (!offer) throw new Error('Missing seeded Freestyle offer');
      const roomId = await fixture.room(host, offer.format_id, {
        template_id: offer.id,
        format_version: offer.format_version,
      });
      const before =
        await client`select to_jsonb(r) as room from rooms r where id=${roomId}`;
      const offersBefore =
        await client`select to_jsonb(o) as offer from lobby_templates o order by lobby_id,template_id`;
      await scratch.migrate(() => true);
      const after =
        await client`select to_jsonb(r)-'standing_template_id'-'league_ladder_id' as room from rooms r where id=${roomId}`;
      const offersAfter =
        await client`select to_jsonb(o) as offer from lobby_templates o order by lobby_id,template_id`;
      const [pin] =
        await client`select template_id,standing_template_id from rooms where id=${roomId}`;
      assert({
        given: 'a populated standing Room predating league rating selection',
        should:
          'initialize the new marker to null without changing historical ratedness',
        actual: Array.from(
          await client`select league_ladder_id from rooms where id=${roomId}`,
        ),
        expected: [{ league_ladder_id: null }],
      });
      assert({
        given:
          'a populated standing Room with its actual offered template before DEC403',
        should:
          'preserve every Room field and offer while deriving the standing constraint key',
        actual: { room: [...after], offers: [...offersAfter], pin },
        expected: {
          room: [...before],
          offers: [...offersBefore],
          pin: { template_id: offer.id, standing_template_id: offer.id },
        },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
