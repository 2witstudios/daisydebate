import { certificationScopes } from '@daisy/protocol/lobby';
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { oneOf, timestampColumn } from './columns';
import { events } from './events';
import { actionHistory } from './grants';
import { results } from './results';

/**
 * A host's confirmation of one result or of a whole event's results.
 * Append-only.
 */
export const certifications = pgTable(
  'certifications',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    scope: text('scope').$type<(typeof certificationScopes)[number]>().notNull(),
    commandId: text('command_id').notNull(),
    certifiedAt: timestampColumn('certified_at').notNull(),
  },
  (table) => [
    unique('certifications_id_event_unique').on(
      table.id,
      table.eventId,
      table.lobbyId,
    ),
    index('certifications_event_idx').on(table.eventId, table.lobbyId),
    index('certifications_command_idx').on(table.commandId, table.lobbyId),
    foreignKey({
      name: 'certifications_event_fk',
      columns: [table.eventId, table.lobbyId],
      foreignColumns: [events.id, events.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'certifications_command_fk',
      columns: [table.commandId, table.lobbyId],
      foreignColumns: [actionHistory.commandId, actionHistory.lobbyId],
    }).onDelete('restrict'),
    check('certifications_scope_check', oneOf(table.scope, certificationScopes)),
  ],
);

/**
 * Exactly which results of its event a certification confirmed. A later
 * correction is a new result, so it is in no certification until a new one
 * names it, and a sanctioning league does not receive it until then.
 * Append-only.
 */
export const certificationResults = pgTable(
  'certification_results',
  {
    certificationId: text('certification_id').notNull(),
    resultId: text('result_id').notNull(),
    eventId: text('event_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.certificationId, table.resultId] }),
    index('certification_results_certification_idx').on(
      table.certificationId,
      table.eventId,
      table.lobbyId,
    ),
    index('certification_results_result_idx').on(
      table.resultId,
      table.eventId,
      table.lobbyId,
    ),
    foreignKey({
      name: 'certification_results_certification_fk',
      columns: [table.certificationId, table.eventId, table.lobbyId],
      foreignColumns: [
        certifications.id,
        certifications.eventId,
        certifications.lobbyId,
      ],
    }).onDelete('restrict'),
    foreignKey({
      name: 'certification_results_result_fk',
      columns: [table.resultId, table.eventId, table.lobbyId],
      foreignColumns: [results.id, results.eventId, results.lobbyId],
    }).onDelete('restrict'),
  ],
);
