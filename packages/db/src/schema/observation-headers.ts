import { bigint, check, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { oneOf } from './columns';

/** Metadata only. Inbox resource identifiers are actor-scoped; no protected body is stored. */
export const observationHeaders = pgTable(
  'resource_observation_headers',
  {
    kind: text('kind').notNull(),
    resourceId: text('resource_id').notNull(),
    contentRevision: bigint('content_revision', { mode: 'number' })
      .notNull()
      .default(1),
    disclosureRevision: bigint('disclosure_revision', { mode: 'number' })
      .notNull()
      .default(1),
    purgeGeneration: bigint('purge_generation', { mode: 'number' })
      .notNull()
      .default(0),
  },
  (t) => [
    primaryKey({ columns: [t.kind, t.resourceId] }),
    check(
      'observation_header_kind',
      oneOf(t.kind, ['room', 'round', 'channel', 'inbox']),
    ),
    check('observation_header_id', sql`${t.resourceId} ~ '^[a-z0-9]{24}$'`),
    check(
      'observation_header_bounds',
      sql`${t.contentRevision} between 1 and 9007199254740991 and ${t.disclosureRevision} between 1 and 9007199254740991 and ${t.purgeGeneration} between 0 and 9007199254740991`,
    ),
  ],
);
