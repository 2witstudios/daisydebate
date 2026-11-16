import {
  leagueSchoolStatuses,
  type LeagueSchoolStatus,
} from '@daisy/protocol/lobby/league-school-command';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { organizations } from './organizations';
import { users } from './users';
import { constantText } from './tenant-keys';
import {
  timestampColumn,
  versionColumn,
  versionPositive,
  oneOf,
} from './columns';

/** League invitation, school assent, and explicit termination; never inferred from a person's membership. */
export const leagueSchools = pgTable(
  'league_schools',
  {
    id: text('id').primaryKey(),
    /** The league is the relation's canonical organization isolation key. */
    leagueId: text('organization_id').notNull(),
    leagueKind: constantText('league_kind', 'league'),
    schoolId: text('school_id').notNull(),
    schoolKind: constantText('school_kind', 'school'),
    status: text('status').$type<LeagueSchoolStatus>().notNull(),
    invitedByUserId: text('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    invitedAt: timestampColumn('invited_at').notNull(),
    joinedByUserId: text('joined_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    joinedAt: timestampColumn('joined_at'),
    endedByUserId: text('ended_by_user_id').references(() => users.id, {
      onDelete: 'restrict',
    }),
    endedAt: timestampColumn('ended_at'),
    version: versionColumn(),
  },
  (table) => [
    unique('league_schools_pair_unique').on(table.leagueId, table.schoolId),
    foreignKey({
      name: 'league_schools_league_fk',
      columns: [table.leagueId, table.leagueKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    foreignKey({
      name: 'league_schools_school_fk',
      columns: [table.schoolId, table.schoolKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete('restrict'),
    index('league_schools_school_idx').on(table.schoolId),
    check(
      'league_schools_status_check',
      oneOf(table.status, leagueSchoolStatuses),
    ),
    check(
      'league_schools_state_check',
      sql`(${table.status} = 'invited' and ${table.joinedAt} is null and ${table.joinedByUserId} is null and ${table.endedAt} is null and ${table.endedByUserId} is null)
    or (${table.status} = 'active' and ${table.joinedAt} is not null and ${table.joinedByUserId} is not null and ${table.endedAt} is null and ${table.endedByUserId} is null)
    or (${table.status} = 'ended' and (${table.joinedAt} is null) = (${table.joinedByUserId} is null) and ${table.endedAt} is not null and ${table.endedByUserId} is not null)`,
    ),
    check(
      'league_schools_time_check',
      sql`(${table.joinedAt} is null or ${table.joinedAt} >= ${table.invitedAt}) and (${table.endedAt} is null or ${table.endedAt} >= coalesce(${table.joinedAt}, ${table.invitedAt}))`,
    ),
    versionPositive('league_schools', table.version),
  ],
);
