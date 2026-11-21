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
const migration = '20261117122353_tab_wiring';
afterAll(() => scratch.drop());

type TemplateOfferRow = {
  readonly offer: {
    readonly lobby_id: string;
    readonly lobby_kind: string;
    readonly template_id: string;
    readonly created_at: string;
    readonly withdrawn_at: string | null;
  };
};

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
      const offersBefore = await client<
        TemplateOfferRow[]
      >`select to_jsonb(o) as offer from lobby_templates o order by lobby_id,template_id`;
      await scratch.migrate(() => true);
      const [youthLobby] = await client`select youth.id
        from lobbies youth join lobbies original on youth.owner_organization_id=original.owner_organization_id
        where original.id=${publicLobbyId} and youth.kind='standing' and youth.age_rule='under-18'`;
      if (!youthLobby) throw new Error('Missing migrated Youth lobby');
      const after =
        await client`select to_jsonb(r)-'standing_template_id'-'league_ladder_id'-'holds_host'-'legacy_tournament_youth' as room from rooms r where id=${roomId}`;
      const offersAfter = await client<
        TemplateOfferRow[]
      >`select to_jsonb(o) as offer from lobby_templates o order by lobby_id,template_id`;
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
          'retain the Room and its offer while copying the Open offers to the new Youth lobby',
        actual: {
          room: [...after],
          offers: offersAfter.filter(
            ({ offer }) => offer.lobby_id !== youthLobby.id,
          ),
          youthOffers: offersAfter.filter(
            ({ offer }) => offer.lobby_id === youthLobby.id,
          ),
          pin,
        },
        expected: {
          room: [...before],
          offers: [...offersBefore],
          youthOffers: offersBefore
            .filter(({ offer }) => offer.lobby_id === publicLobbyId)
            .map(({ offer }) => ({
              offer: { ...offer, lobby_id: youthLobby.id },
            })),
          pin: { template_id: offer.id, standing_template_id: offer.id },
        },
      });
    } finally {
      await client.close();
    }
  },
  ddlTimeoutMs,
);
