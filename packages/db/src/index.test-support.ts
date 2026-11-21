import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from './index';
import { oneOnOneSettings } from './reference-formats';
import { createTestOnlyOperations } from './test-only-operations';
import type { DatabaseEventSink } from './instrumented';
import { validRules } from './testing-rules';
import { fakeSql, type ScriptedResult } from './scripted-bun-wire';

export { fakeSql } from './scripted-bun-wire';

type SinkEvent = {
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

export const roomRow = (overrides: Record<string, unknown> = {}) => {
  const row = {
    id: 'r1o2o3m4i5d6e7n8t9i1f5y3',
    hostActorId: 'host-actor',
    hostInherited: false,
    title: 'Proof room',
    topic: 'A motion',
    visibility: 'public',
    version: 1,
    changeVersion: 1,
    formatId: 'foundation',
    formatVersion: 1,
    presetVersion: null,
    basisFormatId: null,
    basisPresetVersion: null,
    leagueLadderId: null,
    competitionType: 'casual',
    division: 'open',
    teamOneSide: 'affirmative',
    holdsHost: false,
    config: oneOnOneSettings,
    capture: null,
    postRoundCall: false,
    executionPlan: {
      preRoundPrep: { enabled: false },
      resolutionDraw: { enabled: false },
    },
    rulesSnapshot: validRules,
    status: 'assembling',
    lastCommandAt: new Date(0),
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...overrides,
  };
  // Drizzle maps positional driver rows in the rooms schema's column order.
  return [
    row.id,
    row.hostActorId,
    row.hostInherited,
    row.title,
    row.topic,
    row.visibility,
    row.version,
    row.changeVersion,
    row.formatId,
    row.formatVersion,
    row.presetVersion,
    row.basisFormatId,
    row.basisPresetVersion,
    row.leagueLadderId,
    row.competitionType,
    row.division,
    row.teamOneSide,
    row.holdsHost,
    row.config,
    row.capture,
    row.postRoundCall,
    row.executionPlan,
    row.rulesSnapshot,
    row.status,
    row.lastCommandAt,
    row.createdAt,
    row.updatedAt,
  ];
};

export { validRules };
