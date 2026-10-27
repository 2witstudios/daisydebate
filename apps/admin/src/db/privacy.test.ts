import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { validatePrivacyAdoption } from '@daisy/protocol/privacy';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import * as schema from './schema';
import { adminPrivacyFields } from './privacy';

setupRitewayBun();
test('admin privacy declarations match the admin schema', () => {
  const tables = Object.values(schema).filter((value) => is(value, PgTable));
  const expected = Object.fromEntries(
    tables.map((table) => [
      getTableName(table),
      Object.values(getTableColumns(table)).map((column) => column.name),
    ]),
  );
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
