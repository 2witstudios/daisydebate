import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { validatePrivacyAdoption } from '@daisy/protocol/privacy';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import * as schema from './schema';
import { adminPrivacyFields } from './privacy';

setupRitewayBun();
test('admin privacy declarations match the admin schema', () => {
  const expected: Record<string, string[]> = {};
  for (const value of Object.values(schema))
    if (is(value, PgTable)) {
      const { name, columns } = getTableConfig(value);
      expected[name] = columns.map((column) => column.name);
    }
  assert({
    given: 'every table and column of the admin Drizzle schema',
    should:
      'declare each exactly once, holding activation while audit retention is pending',
    actual: [
      Object.keys(expected).length,
      validatePrivacyAdoption(expected, adminPrivacyFields),
    ],
    expected: [8, { problems: [], activationHeld: true }],
  });
});
