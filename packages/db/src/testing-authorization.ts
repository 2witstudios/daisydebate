import { drizzle } from 'drizzle-orm/bun-sql';
import type { AuthorizationTransaction } from './authorization';
import { fakeSql } from './index.test-support';

/**
 * Builds a real Drizzle authorization transaction over the shared scripted
 * Bun wire helper. Consumers exercise production query building and mapping;
 * only the driver responses are scripted.
 */
export function createScriptedAuthorizationTransaction(
  script: Parameters<typeof fakeSql>[0],
) {
  const { client, queries } = fakeSql(script);
  return {
    transaction: drizzle({ client }) as AuthorizationTransaction,
    queries,
  };
}
