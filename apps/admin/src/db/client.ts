import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';

export type AdminDatabase = BunSQLDatabase;
export type AdminTransaction = Parameters<
  Parameters<AdminDatabase['transaction']>[0]
>[0];
/** Anything that runs queries: the pool or an open transaction. */
export type AdminExecutor = AdminDatabase | AdminTransaction;

export type AdminDatabaseHandle = {
  readonly db: AdminDatabase;
  readonly close: () => Promise<void>;
};

export function openAdminDatabase(
  url: string,
  options: { readonly max?: number } = {},
): AdminDatabaseHandle {
  const client = new SQL(url, { max: options.max ?? 5, connectionTimeout: 5 });
  return {
    db: drizzle({ client }),
    close: () => client.close({ timeout: 5 }),
  };
}
