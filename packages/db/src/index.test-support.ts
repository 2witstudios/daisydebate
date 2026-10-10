import { createId } from '@paralleldrive/cuid2';
import type { RoundStatus } from '@daisy/protocol';
import { createDatabase } from './index';
import { foundationDefinition, practiceRoomConfig } from './reference-formats';
import { createTestOnlyOperations } from './test-only-operations';
import type { DatabaseEventSink } from './instrumented';
import { validRules } from './testing';
import { fakeSql, type ScriptedResult } from './scripted-bun-wire';

export { fakeSql } from './scripted-bun-wire';

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

/** A database whose server refuses connections, recording sink events. */
export const unreachableDatabase = () => {
  const events: SinkEvent[] = [];
  const database = createDatabase({
    url: 'postgresql://user:password@127.0.0.1:1/daisy',
    eventSink: (event, fields, message) =>
      events.push({ event, fields, message }),
    nextActorId: createId,
  });
  return { database, events };
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
export const roundRow = (record: {
  id: string;
  roomId: string | null;
  createdByActorId: string | null;
  visibility?: string | null;
  roomConfigSnapshot?: unknown;
  resolution: string;
  competitionType: 'ranked' | 'casual' | 'practice';
  length: 'full' | 'quick';
  formatId: string;
  formatVersion: number;
  presetVersion: number | null;
  rules: unknown;
  status: RoundStatus;
  currentStage: string | null;
  outcome: string | null;
  ladderId: string | null;
  startedAt: string | null;
  completedAt: string | null;
  checkpoint: unknown;
  createdAt: string;
  updatedAt: string;
  version: number;
}): unknown[] => [
  record.id,
  record.roomId,
  record.createdByActorId,
  record.visibility ?? null,
  record.resolution,
  record.competitionType,
  record.length,
  record.formatId,
  record.formatVersion,
  record.presetVersion,
  record.roomConfigSnapshot ?? null,
  record.rules,
  record.status,
  record.currentStage,
  record.outcome,
  record.ladderId,
  record.startedAt === null ? null : new Date(record.startedAt),
  record.completedAt === null ? null : new Date(record.completedAt),
  record.checkpoint,
  new Date(record.createdAt),
  new Date(record.updatedAt),
  record.version,
];

// The columns `getFormat` selects, in selection order.
export const formatRow = (record: {
  id: string;
  name: string;
  version: number;
  definition: unknown;
}): unknown[] => [record.id, record.name, record.version, record.definition];

export const sampleFormat = () => ({
  id: 'foundation',
  name: 'Foundation (architectural proof)',
  version: 1,
  definition: foundationDefinition,
});

export const roomRow = (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: 'r1o2o3m4i5d6e7n8t9i1f5y3',
    hostActorId: 'host-actor',
    title: 'Proof room',
    topic: 'A motion',
    visibility: 'public',
    version: 1,
    changeVersion: 1,
    formatId: 'foundation',
    formatVersion: 1,
    presetVersion: null,
    competitionType: 'casual',
    length: 'full',
    config: practiceRoomConfig,
    executionPlan: { preRoundPrep: { enabled: false } },
    rulesSnapshot: validRules,
    prepStartedAt: null,
    prepRemainingMs: null,
    status: 'assembling',
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
  // Drizzle maps positional driver rows in the rooms schema's column order.
  return [
    row.id,
    row.hostActorId,
    row.title,
    row.topic,
    row.visibility,
    row.version,
    row.changeVersion,
    row.formatId,
    row.formatVersion,
    row.presetVersion,
    row.competitionType,
    row.length,
    row.config,
    row.executionPlan,
    row.rulesSnapshot,
    row.prepStartedAt,
    row.prepRemainingMs,
    row.status,
    row.createdAt,
    row.updatedAt,
  ];
};

export { validRules };
