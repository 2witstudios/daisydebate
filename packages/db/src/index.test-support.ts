import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import type { DebatePhase } from '@daisy/protocol';
import {
  createDatabase,
  type DebateMode,
  type DebateOutcome,
  type DebateVisibility,
} from './index';
import { createTestOnlyOperations } from './test-only-operations';
import type { DatabaseEventSink } from './instrumented';

type RecordedQuery = { query: string; params: unknown[] };
/**
 * A drizzle typed query (`.insert().returning()` etc.) maps positional
 * arrays; a raw `tx.execute(sql...)` (`appendOutboxEvent`'s `pg_notify`
 * call) gets named-object rows straight from the driver, so a script entry
 * may be either shape.
 */
type ScriptedResult =
  readonly (readonly unknown[] | Record<string, unknown>)[] | Error;

/**
 * Stands in for the Bun SQL wire protocol only: real drizzle query building
 * runs against scripted positional results, exactly as the driver maps them
 * (drizzle-orm 1.0's bun-sql session uses unsafe().values() plus begin() for
 * transactions).
 */
function fakeSql(script: ScriptedResult[]): {
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

/** A `client.listen()` that rejects, for proving `checkListen` fails closed. */
export function fakeSqlWithBrokenListen(script: ScriptedResult[]): {
  client: SQL;
  queries: RecordedQuery[];
} {
  const { client, queries } = fakeSql(script);
  return {
    client: Object.assign(client, {
      listen: () => Promise.reject(new Error('listen unavailable')),
    }),
    queries,
  };
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
  const eventSink: DatabaseEventSink = (event, fields, message) =>
    events.push({ event, fields, message });
  const database = {
    ...createDatabase({
      url: 'postgresql://unit:unit@127.0.0.1:1/unit',
      eventSink,
      client,
      nextActorId: createId,
    }),
    // Test-only surface (ISSUE-8 AC1): `transaction`, `createUser` and
    // `saveSnapshot` have no production consumer, so `createDatabase()`
    // never returns them; this composes them in for this package's own
    // unit tests only.
    ...createTestOnlyOperations({ client, eventSink }),
  };
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
  mode: DebateMode;
  phase: DebatePhase;
  visibility: DebateVisibility;
  startedAt: string | null;
  completedAt: string | null;
  outcome: DebateOutcome | null;
}): unknown[] => [
  record.id,
  record.createdBy,
  record.resolution,
  record.format,
  record.snapshot,
  new Date(record.createdAt),
  new Date(record.updatedAt),
  record.version,
  record.mode,
  record.phase,
  record.visibility,
  record.startedAt === null ? null : new Date(record.startedAt),
  record.completedAt === null ? null : new Date(record.completedAt),
  record.outcome,
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
  deletedAt: Date | null;
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
  record.deletedAt,
];

/** A snapshot that satisfies the protocol schema every jsonb write parses. */
export const sampleSnapshot = (
  overrides: Partial<{ phase: DebatePhase; resolution: string }> = {},
) => ({
  version: 1 as const,
  id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
  resolution: 'A representative resolution',
  format: 'public-forum',
  rules: {
    version: 1 as const,
    seats: { affirmative: 1, negative: 1, judge: 0 },
    clock: { speechMs: 240_000, prepMs: 120_000 },
  },
  phase: 'waiting' as DebatePhase,
  createdAt: '2026-01-01T00:00:00.000Z',
  participants: [],
  ...overrides,
});

export const sampleDebate = () => ({
  id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
  createdBy: null,
  resolution: 'A representative resolution',
  format: 'public-forum',
  snapshot: sampleSnapshot(),
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  version: 1,
  mode: 'casual' as const,
  phase: 'waiting' as const,
  visibility: 'unlisted' as const,
  startedAt: null,
  completedAt: null,
  outcome: null,
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
  deletedAt: null,
});

// The columns `getFormat` selects, in selection order.
export const formatRow = (record: {
  id: string;
  rules: unknown;
  rankedEligible: boolean;
}): unknown[] => [record.id, record.rules, record.rankedEligible];

export const sampleFormat = () => ({
  id: 'foundation',
  name: 'Foundation (architectural proof)',
  rules: {
    version: 1 as const,
    seats: { affirmative: 1, negative: 1, judge: 0 },
    clock: { speechMs: 240_000, prepMs: 120_000 },
  },
  rankedEligible: false,
});
