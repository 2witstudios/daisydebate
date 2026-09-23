import type { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import type { DebatePhase } from '@daisy/protocol';
import {
  createDatabase,
  type DebateMode,
  type DebateOutcome,
  type DebateVisibility,
} from './index';

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
    nextActorId: createId,
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

export const sampleDebate = () => ({
  id: 'k2v9x0f4m8q3w1z7c5n6b4d2',
  createdBy: null,
  resolution: 'A representative resolution',
  format: 'public-forum',
  snapshot: { phase: 'waiting', resolution: 'A representative resolution' },
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
