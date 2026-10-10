import type { SQL } from 'bun';

export type RecordedQuery = { query: string; params: unknown[] };

/**
 * A drizzle typed query (`.insert().returning()` etc.) maps positional
 * arrays; a raw `tx.execute(sql...)` gets named-object rows straight from the
 * driver, so a script entry may be either shape.
 */
export type ScriptedResult =
  readonly (readonly unknown[] | Record<string, unknown>)[] | Error;

/**
 * Stands in for the Bun SQL wire protocol only: real drizzle query building
 * runs against scripted positional results, exactly as the driver maps them
 * (drizzle-orm 1.0's bun-sql session uses unsafe().values() plus begin()).
 */
export function fakeSql(script: ScriptedResult[]): {
  client: SQL;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    // drizzle-orm 1.0's bun-sql driver sets `options.bigint` on its client.
    options: {},
    unsafe(query: string, params: unknown[] = []) {
      queries.push({ query, params });
      const next = script.shift();
      if (next instanceof Error) {
        // Pre-consume the base rejection: the real driver is one awaitable
        // object, while this fake forks a second promise for .values().
        const rejected = Promise.reject(next);
        rejected.catch(() => {});
        return Object.assign(rejected, { values: () => Promise.reject(next) });
      }
      const rows = next ?? [];
      return Object.assign(Promise.resolve(rows), {
        values: () => Promise.resolve(rows),
      });
    },
    begin(operation: (inner: unknown) => Promise<unknown>) {
      return operation(client);
    },
    async listen() {
      return { unlisten: async () => {} };
    },
    async close() {},
  };
  return { client: client as unknown as SQL, queries };
}
