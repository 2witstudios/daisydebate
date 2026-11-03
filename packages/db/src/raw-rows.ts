import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import type { SQL } from 'drizzle-orm';

/** The rows of one raw statement, as the caller says they are. */
export const rowsOf = async <T>(
  tx: Pick<BunSQLDatabase, 'execute'>,
  query: SQL,
) => (await tx.execute(query)) as unknown as T[];
