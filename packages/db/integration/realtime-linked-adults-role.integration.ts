import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readRoundYouth } from '../src/round-youth-read';
import { withFixture } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

const TENANT_TABLES = [
  'account_age',
  'grants',
  'guardian_links',
  'memberships',
  'organizations',
  'role_permissions',
];

test('realtime reads a Round’s Room division and nothing of the linked-adult read’s tenant tables (ADR 0155, ADR 0158, ADR 0129)', async () => {
  await withFixture(url, async (fixture) => {
    const held = await fixture.sql`
      select distinct table_name from information_schema.column_privileges
      where grantee = 'daisy_realtime' and table_schema = 'public'
        and table_name in ${fixture.sql(TENANT_TABLES)}`;
    const [division] = await fixture.sql`
      select has_column_privilege('daisy_realtime', 'public.rooms', 'division', 'SELECT') as allowed`;
    const youth = await fixture.sql.begin(async (client) => {
      await client`set local role daisy_realtime`;
      return readRoundYouth(drizzle({ client }), createId());
    });
    assert({
      given: 'the realtime role after ADR 0155',
      should:
        'read rooms.division (a missing Round answers null) and hold no privilege on any tenant-owned table the people read touches: it reads them only through daisy_round_linked_adult_actors',
      actual: { division: division!.allowed, youth, tenantTables: held.length },
      expected: { division: true, youth: null, tenantTables: 0 },
    });
  });
});
