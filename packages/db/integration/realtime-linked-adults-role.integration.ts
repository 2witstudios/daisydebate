import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readRoundYouth } from '../src/round-youth-read';
import { withFixture } from './constraint-helpers';
import { validConfig } from './round-fixtures';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const TENANT_TABLES = [
  'account_age',
  'grants',
  'guardian_links',
  'memberships',
  'organizations',
  'lobbies',
  'role_permissions',
];

test('realtime classifies Room age rules through the registered definer', async () => {
  await withFixture(url, async (fixture) => {
    const held = await fixture.sql`
      select distinct table_name from information_schema.column_privileges
      where grantee = 'daisy_realtime' and table_schema = 'public'
        and table_name in ${fixture.sql(TENANT_TABLES)}`;
    const [installed] = await fixture.sql`
      select p.prosecdef as definer, p.proconfig as config,
        has_function_privilege('daisy_realtime', p.oid, 'EXECUTE') as allowed,
        has_function_privilege('daisy_realtime',
          'public.daisy_debater_was_under_18(text,timestamptz)', 'EXECUTE') as arbitrary_subject_allowed,
        has_function_privilege('daisy_realtime',
          'public.daisy_round_reuse_age_unknown(text)', 'EXECUTE') as reuse_age_allowed
      from pg_proc p where p.oid='public.daisy_room_is_youth(text)'::regprocedure`;
    const lobbies = await fixture.sql`
      select l.id from lobbies l join organizations o on o.id=l.owner_organization_id
        where o.official and l.kind='standing' and l.age_rule in ('adults','under-18')
        order by l.age_rule`;
    const host = await fixture.actor();
    const formatId = await fixture.format();
    const roundIds: string[] = [];
    for (const lobby of lobbies) {
      const room = await fixture.room(host, formatId, { lobby_id: lobby.id });
      roundIds.push(
        await fixture.round({
          room_id: room,
          format_id: formatId,
          room_config_snapshot: validConfig,
          visibility: 'public',
        }),
      );
    }
    const results = await fixture.sql.begin(async (client) => {
      await client`set local role daisy_realtime`;
      const db = drizzle({ client });
      const youth = [];
      for (const id of [...roundIds, createId()])
        youth.push(await readRoundYouth(db, id));
      return youth;
    });
    assert({
      given:
        'the migrated schema, both official age rules, and the realtime role',
      should:
        'classify the real Rooms through a pinned definer without privileges on tenant inputs',
      actual: { installed, results, tenantTables: held.length },
      expected: {
        installed: {
          definer: true,
          config: ['search_path=pg_catalog, public, pg_temp'],
          allowed: true,
          arbitrary_subject_allowed: false,
          reuse_age_allowed: false,
        },
        results: [false, true, null],
        tenantTables: 0,
      },
    });
  });
});
