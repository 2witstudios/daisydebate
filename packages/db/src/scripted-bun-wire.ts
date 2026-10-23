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
 * How a reserved connection answers the bounded transaction's own protocol
 * statements (backend identity, begin, session limits, commit, recovery);
 * every other statement consumes the shared script.
 */
export type ScriptedProtocol = {
  /** The tag the server reports for `commit`; anything else is a failed commit. */
  readonly commit?: string;
  /** Whether recovery observes the writer backend gone. */
  readonly absent?: boolean;
};

/** Reservations handed out by the fake, for asserting release versus close. */
export type ScriptedReservations = {
  reserved: number;
  released: number;
  closed: number;
};

const backend = {
  pid: 4242,
  started: '2026-10-22 12:00:00.000000+00',
  receivedAt: '2026-10-22T12:00:00.000000Z',
};

function protocolRows(
  query: string,
  protocol: ScriptedProtocol,
): ScriptedResult | undefined {
  const text = query.trim();
  if (text.startsWith('select pg_backend_pid()')) return [backend];
  if (text.startsWith('begin isolation level read committed')) return [];
  if (/^select\s+set_config\('statement_timeout'/.test(text)) return [];
  if (text === 'commit')
    return Object.assign([], { command: protocol.commit ?? 'COMMIT' });
  if (text.startsWith('select pg_terminate_backend(')) return [];
  if (text === 'select pg_stat_clear_snapshot()') return [];
  if (text.startsWith('select not exists ('))
    return [{ absent: protocol.absent ?? true }];
  return undefined;
}

const settled = (next: ScriptedResult | undefined) => {
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
};

/**
 * Stands in for the Bun SQL wire protocol only: real drizzle query building
 * runs against scripted positional results, exactly as the driver maps them
 * (drizzle-orm 1.0's bun-sql session uses unsafe().values() plus begin()).
 * A reservation is a callable tagged template as in Bun, sharing the script.
 */
export function fakeSql(
  script: ScriptedResult[],
  protocol: ScriptedProtocol = {},
): {
  client: SQL;
  queries: RecordedQuery[];
  reservations: ScriptedReservations;
} {
  const queries: RecordedQuery[] = [];
  const reservations: ScriptedReservations = {
    reserved: 0,
    released: 0,
    closed: 0,
  };
  const run = (query: string, params: unknown[]) => {
    queries.push({ query, params });
    const answer = protocolRows(query, protocol);
    return settled(answer ?? script.shift());
  };
  const client = {
    // drizzle-orm 1.0's bun-sql driver sets `options.bigint` on its client.
    options: {},
    unsafe: (query: string, params: unknown[] = []) =>
      settled((queries.push({ query, params }), script.shift())),
    begin(operation: (inner: unknown) => Promise<unknown>) {
      return operation(client);
    },
    async listen() {
      return { unlisten: async () => {} };
    },
    async close() {},
    async reserve() {
      reservations.reserved += 1;
      const reserved = (strings: readonly string[], ...params: unknown[]) =>
        run(strings.join('$n'), params);
      const connection = Object.assign(reserved, {
        options: {},
        unsafe: (query: string, params: unknown[] = []) => run(query, params),
        begin: (operation: (inner: unknown) => Promise<unknown>) =>
          operation(connection),
        release() {
          reservations.released += 1;
        },
        async close() {
          reservations.closed += 1;
        },
      });
      return connection;
    },
  };
  return { client: client as unknown as SQL, queries, reservations };
}
