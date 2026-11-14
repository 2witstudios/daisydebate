import {
  guardianLinkKinds,
  guardianLinkStatuses,
  videoAudienceCaps,
} from '@daisy/protocol/lobby';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  oneOf,
  timestampColumn,
  updatedAtColumn,
  versionColumn,
  versionPositive,
} from './columns';
import { lobbies } from './lobbies';
import { organizations } from './organizations';
import { constantText } from './tenant-keys';
import { users } from './users';

/**
 * A parent or coach acting for a minor's account: a relationship between
 * two people, never a role. A coach's link runs through a school. It holds
 * no consent: consent evidence, when counsel defines it, is not a field
 * here. The runtime role cannot insert into this table or the two below
 * until a later, counsel-gated migration opens them.
 */
export const guardianLinks = pgTable(
  'guardian_links',
  {
    id: text('id').primaryKey(),
    guardianUserId: text('guardian_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    minorUserId: text('minor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    kind: text('kind').$type<(typeof guardianLinkKinds)[number]>().notNull(),
    viaOrganizationId: text('via_organization_id'),
    viaOrganizationKind: constantText('via_organization_kind', 'school'),
    status: text('status')
      .$type<(typeof guardianLinkStatuses)[number]>()
      .notNull(),
    endedAt: timestampColumn('ended_at'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('guardian_links_id_people_unique').on(
      table.id,
      table.guardianUserId,
      table.minorUserId,
    ),
    uniqueIndex('guardian_links_open_pair_unique')
      .on(table.guardianUserId, table.minorUserId)
      .where(sql`${table.status} <> 'ended'`),
    index('guardian_links_guardian_user_idx').on(table.guardianUserId),
    index('guardian_links_minor_user_idx').on(table.minorUserId),
    index('guardian_links_via_organization_idx').on(
      table.viaOrganizationId,
      table.viaOrganizationKind,
    ),
    foreignKey({
      name: 'guardian_links_via_school_fk',
      columns: [table.viaOrganizationId, table.viaOrganizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    check('guardian_links_kind_check', oneOf(table.kind, guardianLinkKinds)),
    check(
      'guardian_links_status_check',
      oneOf(table.status, guardianLinkStatuses),
    ),
    check(
      'guardian_links_two_people',
      sql`${table.guardianUserId} <> ${table.minorUserId}`,
    ),
    check(
      'guardian_links_coach_via_school',
      sql`(${table.kind} = 'coach') = (${table.viaOrganizationId} is not null)`,
    ),
    check(
      'guardian_links_ended_consistent',
      sql`(${table.status} = 'ended') = (${table.endedAt} is not null)`,
    ),
    versionPositive('guardian_links', table.version),
  ],
);

/**
 * What a guardian sets for a minor: whether the minor is limited to the
 * lobbies listed below, and who may see video of the child. The evaluator
 * reads these rows as facts and derives the rest.
 */
export const restrictions = pgTable(
  'restrictions',
  {
    guardianLinkId: text('guardian_link_id').primaryKey(),
    guardianUserId: text('guardian_user_id').notNull(),
    minorUserId: text('minor_user_id').notNull(),
    limitsLobbies: boolean('limits_lobbies').notNull().default(false),
    videoAudienceCap: text('video_audience_cap')
      .$type<(typeof videoAudienceCaps)[number]>()
      .notNull()
      .default('lobby'),
    createdAt: createdAtColumn(),
    updatedAt: updatedAtColumn(),
    version: versionColumn(),
  },
  (table) => [
    unique('restrictions_link_people_unique').on(
      table.guardianLinkId,
      table.guardianUserId,
      table.minorUserId,
    ),
    foreignKey({
      name: 'restrictions_guardian_link_fk',
      columns: [table.guardianLinkId, table.guardianUserId, table.minorUserId],
      foreignColumns: [
        guardianLinks.id,
        guardianLinks.guardianUserId,
        guardianLinks.minorUserId,
      ],
    }).onDelete('cascade'),
    check(
      'restrictions_video_audience_cap_check',
      oneOf(table.videoAudienceCap, videoAudienceCaps),
    ),
    versionPositive('restrictions', table.version),
  ],
);

/**
 * A lobby a guardian allows. `lobby_id` here is the allowed lobby, not an
 * isolation key: the row belongs to the two people of the link.
 */
export const restrictionLobbies = pgTable(
  'restriction_lobbies',
  {
    guardianLinkId: text('guardian_link_id').notNull(),
    guardianUserId: text('guardian_user_id').notNull(),
    minorUserId: text('minor_user_id').notNull(),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => lobbies.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.guardianLinkId, table.lobbyId] }),
    index('restriction_lobbies_restriction_idx').on(
      table.guardianLinkId,
      table.guardianUserId,
      table.minorUserId,
    ),
    index('restriction_lobbies_lobby_idx').on(table.lobbyId),
    foreignKey({
      name: 'restriction_lobbies_restriction_fk',
      columns: [table.guardianLinkId, table.guardianUserId, table.minorUserId],
      foreignColumns: [
        restrictions.guardianLinkId,
        restrictions.guardianUserId,
        restrictions.minorUserId,
      ],
    }).onDelete('cascade'),
  ],
);
