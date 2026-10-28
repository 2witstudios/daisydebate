import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { oneOf, timestampColumn } from './columns';

/**
 * Contacts: the Social base Messaging and Friends both build on (ADR 0072,
 * ADR 0061). It owns the canonical member pair and its blocks, and the
 * DEC-251 social request budget, which counts DM and friend requests alike.
 */
export const contactActorColumn = (name: string) =>
  text(name)
    .notNull()
    .references(() => actors.id, { onDelete: 'restrict' });

/** One durable lock target even when a blocked pair has no DM channel. */
export const contactPairs = pgTable(
  'contact_pairs',
  {
    lowActorId: contactActorColumn('low_actor_id'),
    highActorId: contactActorColumn('high_actor_id'),
    lowBlocksHigh: boolean('low_blocks_high').notNull().default(false),
    highBlocksLow: boolean('high_blocks_low').notNull().default(false),
    revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  },
  (table) => [
    index('contact_pairs_high_actor_idx').on(table.highActorId),
    primaryKey({ columns: [table.lowActorId, table.highActorId] }),
    check(
      'contact_pairs_order',
      sql`${table.lowActorId} < ${table.highActorId}`,
    ),
    check(
      'contact_pairs_revision',
      sql`${table.revision} between 1 and 9007199254740991`,
    ),
  ],
);

/**
 * DEC-251's social request budget: one append-only row per DM or friend
 * request asked, so later pair rows never refill it. `unrelated` snapshots
 * whether the counterpart had no accepted friendship or DM when asked.
 */
export const socialRequests = pgTable(
  'social_requests',
  {
    actorId: contactActorColumn('actor_id'),
    requestId: text('request_id').notNull(),
    counterpartActorId: contactActorColumn('counterpart_actor_id'),
    kind: text('kind').notNull(),
    unrelated: boolean('unrelated').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.requestId] }),
    index('social_requests_actor_created_idx').on(
      table.actorId,
      table.createdAt,
    ),
    index('social_requests_counterpart_actor_idx').on(table.counterpartActorId),
    // The DEC-259 sweep deletes by age alone, across every actor.
    index('social_requests_created_idx').on(table.createdAt),
    check('social_requests_kind', oneOf(table.kind, ['dm', 'friend'])),
    check(
      'social_requests_distinct',
      sql`${table.actorId} <> ${table.counterpartActorId}`,
    ),
  ],
);

/**
 * DEC-251 decline blocks, one row per direction: how often `decliner` has
 * declined `requester` since the count last reset, and until when further
 * requests from `requester` are refused. Acceptance deletes both directions,
 * and the row goes with its contact pair.
 */
export const socialRequestDeclines = pgTable(
  'social_request_declines',
  {
    declinerActorId: contactActorColumn('decliner_actor_id'),
    requesterActorId: contactActorColumn('requester_actor_id'),
    lowActorId: contactActorColumn('low_actor_id'),
    highActorId: contactActorColumn('high_actor_id'),
    declinedCount: bigint('declined_count', { mode: 'number' }).notNull(),
    lastDeclinedAt: timestampColumn('last_declined_at').notNull(),
    blockedUntil: timestampColumn('blocked_until'),
    /** When the row stops counting or blocking; the retention sweep deletes it then. */
    expiresAt: timestampColumn('expires_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.declinerActorId, table.requesterActorId] }),
    index('social_request_declines_pair_idx').on(
      table.lowActorId,
      table.highActorId,
    ),
    index('social_request_declines_requester_idx').on(table.requesterActorId),
    index('social_request_declines_high_actor_idx').on(table.highActorId),
    index('social_request_declines_expires_idx').on(table.expiresAt),
    foreignKey({
      columns: [table.lowActorId, table.highActorId],
      foreignColumns: [contactPairs.lowActorId, contactPairs.highActorId],
    }).onDelete('cascade'),
    check(
      'social_request_declines_pair',
      sql`(${table.lowActorId} = ${table.declinerActorId} and ${table.highActorId} = ${table.requesterActorId}) or (${table.lowActorId} = ${table.requesterActorId} and ${table.highActorId} = ${table.declinerActorId})`,
    ),
    check(
      'social_request_declines_count',
      sql`${table.declinedCount} between 0 and 3`,
    ),
    check(
      'social_request_declines_expiry',
      sql`${table.expiresAt} > ${table.lastDeclinedAt} and (${table.blockedUntil} is null or ${table.blockedUntil} <= ${table.expiresAt})`,
    ),
  ],
);

/**
 * Contacts' own command receipts (a block or an unblock): one row per
 * request, so a retry replays its result instead of acting twice.
 */
export const contactCommands = pgTable(
  'contact_commands',
  {
    actorId: contactActorColumn('actor_id'),
    requestId: text('request_id').notNull(),
    counterpartActorId: contactActorColumn('counterpart_actor_id'),
    kind: text('kind').notNull(),
    digest: text('digest').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.actorId, table.requestId] }),
    index('contact_commands_counterpart_actor_idx').on(
      table.counterpartActorId,
    ),
    check('contact_commands_kind', oneOf(table.kind, ['contact.block'])),
    check('contact_commands_digest', sql`${table.digest} ~ '^[0-9a-f]{64}$'`),
  ],
);
