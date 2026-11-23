import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import type { AdminTxSource } from './tx';

export type AdminDatabaseHandle = {
  readonly db: AdminTxSource;
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
