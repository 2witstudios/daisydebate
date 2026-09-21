import type { SQL } from 'bun';
import { createDatabase } from './index';

type RecordedQuery = { query: string; params: unknown[] };
type ScriptedResult = readonly unknown[][] | Error;

/**
 * Stands in for the Bun SQL wire protocol only: real drizzle query building
 * runs against scripted positional results, exactly as the driver maps them
 * (drizzle-orm/bun-sql uses unsafe().values() plus begin() for transactions).
 */
function fakeSql(script: ScriptedResult[]): {
  client: SQL;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
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
    async close() {},
  };
  return { client: client as unknown as SQL, queries };
}

export type SinkEvent = {
  event: string;
  fields: Record<string, unknown>;
  message: string;
};

export const createTestDatabase = (
  script: ScriptedResult[],
  events: SinkEvent[] = [],
) => {
  const { client, queries } = fakeSql(script);
  const database = createDatabase({
    url: 'postgresql://unit:unit@127.0.0.1:1/unit',
    eventSink: (event, fields, message) =>
      events.push({ event, fields, message }),
    client,
  });
  return { database, queries };
};

// Schema-definition column order; the driver returns rows positionally.
export const debateRow = (record: {
  id: string;
  createdBy: string | null;
  resolution: string;
  format: string;
  snapshot: unknown;
  createdAt: string;
  updatedAt: string;
  version: number;
}): unknown[] => [
  record.id,
  record.createdBy,
  record.resolution,
  record.format,
  record.snapshot,
  new Date(record.createdAt),
  new Date(record.updatedAt),
  record.version,
];

export const userRow = (record: {
  id: string;
  username: string | null;
  email: string | null;
  emailVerified: boolean;
  name: string;
  image: string | null;
  createdAt: Date;
  updatedAt: Date;
  version: number;
}): unknown[] => [
  record.id,
  record.username,
  record.email,
  record.emailVerified,
  record.name,
  record.image,
  record.createdAt,
  record.updatedAt,
  record.version,
];

export const sampleDebate = () => ({
  id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
  createdBy: null,
  resolution: 'A representative resolution',
  format: 'public-forum',
  snapshot: { resolution: 'A representative resolution' },
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
});

export const sampleUser = () => ({
  id: 'a7b3c9d1e5f2k4m6n8p1r3t5',
  username: 'demo',
  email: null,
  emailVerified: false,
  name: '',
  image: null,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
  updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  version: 1,
});
