import {
  entryStatuses,
  responsibleKinds,
} from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import {
  createdAtColumn,
  oneOf,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { events } from './events';
import { guardianLinks } from './guardian-links';
import { organizations } from './organizations';
import { constantText, nonEmpty } from './tenant-keys';

/**
 * A person or team entered in an event, with exactly one kind of
 * responsible adult: a coach through a school, a guardian directly, or the
 * adult entered. The coach is not a column: it is whoever holds the
 * school's roster permission. `division` is a name from the event's
 * `entry.divisions` setting; there is no division table.
 */
export const entries = pgTable(
  'entries',
  {
    id: text('id').primaryKey(),
    lobbyId: text('lobby_id').notNull(),
    eventId: text('event_id').notNull(),
    name: text('name').notNull(),
    status: text('status').$type<(typeof entryStatuses)[number]>().notNull(),
    seed: integer('seed'),
    division: text('division'),
    responsibleKind: text('responsible_kind')
      .$type<(typeof responsibleKinds)[number]>()
      .notNull(),
    schoolOrganizationId: text('school_organization_id'),
    schoolOrganizationKind: constantText('school_organization_kind', 'school'),
    guardianLinkId: text('guardian_link_id').references(
      () => guardianLinks.id,
      { onDelete: 'restrict' },
    ),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('entries_id_event_unique').on(table.id, table.eventId, table.lobbyId),
    index('entries_event_idx').on(table.eventId, table.lobbyId),
    index('entries_school_idx').on(
      table.schoolOrganizationId,
      table.schoolOrganizationKind,
    ),
    index('entries_guardian_link_idx').on(table.guardianLinkId),
    foreignKey({
      name: 'entries_event_fk',
      columns: [table.eventId, table.lobbyId],
      foreignColumns: [events.id, events.lobbyId],
    }).onDelete('restrict'),
    foreignKey({
      name: 'entries_school_fk',
      columns: [table.schoolOrganizationId, table.schoolOrganizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    check('entries_status_check', oneOf(table.status, entryStatuses)),
    check(
      'entries_one_responsible_adult',
      sql`(${table.responsibleKind} = 'school' and ${table.schoolOrganizationId} is not null and ${table.guardianLinkId} is null)
        or (${table.responsibleKind} = 'guardian' and ${table.guardianLinkId} is not null and ${table.schoolOrganizationId} is null)
        or (${table.responsibleKind} = 'self' and ${table.schoolOrganizationId} is null and ${table.guardianLinkId} is null)`,
    ),
    check(
      'entries_division_nonempty',
      sql`${table.division} is null or length(trim(${table.division})) > 0`,
    ),
    nonEmpty('entries_name_nonempty', table.name),
    versionPositive('entries', table.version),
  ],
);

/**
 * The people in an entry. Competition references actors, so the record
 * survives an account's erasure. A person is in one entry per event.
 */
export const entryMembers = pgTable(
  'entry_members',
  {
    entryId: text('entry_id').notNull(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    eventId: text('event_id').notNull(),
    lobbyId: text('lobby_id').notNull(),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.actorId] }),
    unique('entry_members_one_entry_per_event').on(table.eventId, table.actorId),
    index('entry_members_entry_idx').on(
      table.entryId,
      table.eventId,
      table.lobbyId,
    ),
    index('entry_members_actor_idx').on(table.actorId),
    foreignKey({
      name: 'entry_members_entry_fk',
      columns: [table.entryId, table.eventId, table.lobbyId],
      foreignColumns: [entries.id, entries.eventId, entries.lobbyId],
    }).onDelete('cascade'),
  ],
);
