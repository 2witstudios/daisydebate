import { audiences, releaseCauses, releaseThings } from '@daisy/protocol/lobby';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { tabRounds } from './events';
import { actionHistory } from './grants';

/**
 * The fact that a thing opened to an audience for a tab round, and the
 * `when` that opened it. An opening that covers a whole event writes one
 * row per tab round. Recorded at most once per tab round, thing and
 * audience, and append-only, so a later change of an `audience.*` setting
 * never closes what people have already seen. Officials are not an audience
 * and have no rows. Who sees what and when is the settings'; this table
 * holds no rule.
 */
export const releases = pgTable(
  'releases',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    tabRoundId: text('tab_round_id').notNull(),
    thing: text('thing').$type<(typeof releaseThings)[number]>().notNull(),
    audience: text('audience').$type<(typeof audiences)[number]>().notNull(),
    cause: text('cause').$type<(typeof releaseCauses)[number]>().notNull(),
    commandId: text('command_id').notNull(),
    openedAt: timestampColumn('opened_at').notNull(),
  },
  (table) => [
    unique('releases_once').on(table.tabRoundId, table.thing, table.audience),
    index('releases_tab_round_idx').on(
      table.tabRoundId,
      table.eventId,
      table.lobbyId,
    ),
    index('releases_command_idx').on(table.commandId, table.lobbyId),
    index('releases_event_idx').on(table.eventId, table.thing, table.audience),
    foreignKey({
      name: 'releases_tab_round_fk',
      columns: [table.tabRoundId, table.eventId, table.lobbyId],
      foreignColumns: [tabRounds.id, tabRounds.eventId, tabRounds.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'releases_command_fk',
      columns: [table.commandId, table.lobbyId],
      foreignColumns: [actionHistory.commandId, actionHistory.lobbyId],
    }).onDelete('restrict'),
    check('releases_thing_check', oneOf(table.thing, releaseThings)),
    check('releases_audience_check', oneOf(table.audience, audiences)),
    check('releases_cause_check', oneOf(table.cause, releaseCauses)),
  ],
);
