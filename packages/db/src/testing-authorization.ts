import { drizzle } from 'drizzle-orm/bun-sql';
import { fakeSql } from './index.test-support';
/** Real adapter query building against scripted wire rows; not a transaction/service proof. */
export function createScriptedAuthorizationTransaction(
  rows: Parameters<typeof fakeSql>[0],
) {
  const { client, queries } = fakeSql(rows);
  return { tx: drizzle({ client }), queries };
}
