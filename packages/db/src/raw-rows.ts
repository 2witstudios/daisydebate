import type { SQL } from 'drizzle-orm';
import type { Tx } from './tx';

/** The rows of one raw statement, as the caller says they are. */
export const rowsOf = async <T>(tx: Tx, query: SQL) =>
  (await tx.execute(query)) as unknown as T[];
