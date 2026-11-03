import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, unique } from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { seasons } from './ratings';
import { rooms } from './rooms';
import { users } from './users';

/**
 * Each agreement a member can sign, and so what it covers: the season's
 * ranked content waiver, or the capture notice a Room showed before Ready. A
 * tournament's per-event terms add a kind and a tournament scope here.
 */
export const agreementKinds = [
  'ranked-content-waiver',
  'round-capture-notice',
] as const;

/**
 * What a member agreed to: account, agreement, version, the exact words, scope
 * and time (WATCH-9, WATCH-15). The words are on the row because source moves
 * on and a superseded text must still be readable. A row is evidence, so it is never updated, and erasure keeps it
 * with the ranked content it stands behind (docs/operations/compliance.md).
 */
export const agreementSignatures = pgTable(
  'agreement_signatures',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    agreement: text('agreement').notNull(),
    version: text('version').notNull(),
    words: text('words').notNull(),
    seasonId: text('season_id').references(() => seasons.id, {
      onDelete: 'restrict',
    }),
    roomId: text('room_id').references(() => rooms.id, { onDelete: 'cascade' }),
    signedAt: timestampColumn('signed_at').notNull(),
  },
  (table) => [
    unique('agreement_signatures_once')
      .on(
        table.userId,
        table.agreement,
        table.version,
        table.seasonId,
        table.roomId,
      )
      .nullsNotDistinct(),
    index('agreement_signatures_season_idx').on(table.seasonId),
    index('agreement_signatures_room_idx').on(table.roomId),
    check(
      'agreement_signatures_agreement_check',
      oneOf(table.agreement, agreementKinds),
    ),
    check(
      'agreement_signatures_scope_check',
      sql`(${table.agreement} = 'ranked-content-waiver' and ${table.seasonId} is not null and ${table.roomId} is null)
        or (${table.agreement} = 'round-capture-notice' and ${table.roomId} is not null and ${table.seasonId} is null)`,
    ),
  ],
);
