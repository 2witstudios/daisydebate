import type { SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import type { AuthorizationTransaction } from './authorization';

/**
 * A transaction that answers each statement with the next scripted result
 * and records the rendered SQL, for privacy adopter unit tests. Once the
 * script runs out it answers `exhausted()`, which may throw.
 */
export function scriptedTransaction(
  responses: readonly unknown[][],
  exhausted: () => unknown[],
) {
  const remaining = [...responses];
  const queries: { sql: string; params: unknown[] }[] = [];
  const dialect = new PgDialect();
  const tx = {
    execute: async (statement: SQL) => {
      queries.push(dialect.sqlToQuery(statement));
      return remaining.shift() ?? exhausted();
    },
  } as unknown as AuthorizationTransaction;
  return { tx, queries };
}
