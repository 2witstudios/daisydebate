import { entryStatuses, responsibleKinds } from '@daisy/protocol/lobby';
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
  uniqueIndex,
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
    /**
     * The division whose break this entry chose, where it qualified for
     * more than one and the event's `break.double_qualifier` setting is
     * `choice`. Null is no answer; the same names as `division`.
     */
    breakDivision: text('break_division'),
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
    unique('entries_id_event_unique').on(
      table.id,
      table.eventId,
      table.lobbyId,
    ),
    unique('entries_id_status_unique').on(table.id, table.status),
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
    check(
      'entries_break_division_nonempty',
      sql`${table.breakDivision} is null or length(trim(${table.breakDivision})) > 0`,
    ),
    nonEmpty('entries_name_nonempty', table.name),
    versionPositive('entries', table.version),
  ],
);

/**
 * The people in an entry. Competition references actors, so the record
 * survives an account's erasure. A person is in one entry per event that
 * is not withdrawn: `entry_status` is the entry's status, kept equal to it
 * by the cascading foreign key and written by nothing else, so the rule is
 * an index that leaves a withdrawn entry out.
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
    entryStatus: text('entry_status')
      .$type<(typeof entryStatuses)[number]>()
      .notNull()
      .default('pending'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.entryId, table.actorId] }),
    uniqueIndex('entry_members_one_entry_per_event')
      .on(table.eventId, table.actorId)
      .where(sql`${table.entryStatus} <> 'withdrawn'`),
    index('entry_members_entry_status_idx').on(
      table.entryId,
      table.entryStatus,
    ),
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
    foreignKey({
      name: 'entry_members_entry_status_fk',
      columns: [table.entryId, table.entryStatus],
      foreignColumns: [entries.id, entries.status],
    })
      .onUpdate('cascade')
      .onDelete('cascade'),
  ],
);
