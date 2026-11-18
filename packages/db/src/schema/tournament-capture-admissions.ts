import { sql } from 'drizzle-orm';
import { tournamentCaptureAdmissionSchema } from '@daisy/protocol';
import {
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  jsonbColumn,
  jsonbIsObject,
  timestampColumn,
} from './columns';
import { rounds } from './rounds';
import { rooms } from './rooms';
import { tournaments } from './lobbies';
import { fixtures } from './fixtures';
import { users } from './users';
import { actors } from './actors';
import { roomCommands } from './room-commands';
import { accountHostingEntitlementVersions } from './hosting-entitlement-versions';
import { tournamentHostingPurchases } from './tournament-hosting-purchases';
import { tournamentSponsorshipVersions } from './tournament-sponsorships';

/** A frozen obligation holds capacity until Recording confirms physical settlement, never a TTL. */
export const tournamentCaptureAdmissions = pgTable(
  'tournament_capture_admissions',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'restrict' }),
    roomId: text('room_id')
      .notNull()
      .references(() => rooms.id, { onDelete: 'restrict' }),
    lobbyId: text('lobby_id')
      .notNull()
      .references(() => tournaments.lobbyId, { onDelete: 'restrict' }),
    fixtureId: text('fixture_id')
      .notNull()
      .references(() => fixtures.id, { onDelete: 'restrict' }),
    sponsorUserId: text('sponsor_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    /** The hosting grant version that funds it, or null when a purchase does. */
    hostingVersionId: text('hosting_version_id').references(
      () => accountHostingEntitlementVersions.id,
      { onDelete: 'restrict' },
    ),
    /** The tournament's paid hosting purchase that funds it (ADR 0149). */
    hostingPurchaseId: text('hosting_purchase_id').references(
      () => tournamentHostingPurchases.id,
      { onDelete: 'restrict' },
    ),
    sponsorshipVersionId: text('sponsorship_version_id'),
    officialUserId: text('official_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'restrict' }),
    officialActorId: text('official_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    commandId: text('command_id')
      .notNull()
      .references(() => roomCommands.commandId, { onDelete: 'restrict' }),
    admission: jsonbColumn(
      'admission',
      tournamentCaptureAdmissionSchema,
    ).notNull(),
    deadlineAt: timestampColumn('deadline_at').notNull(),
    /** Only the capture owner's confirmed-settlement producer can set this. */
    settledAt: timestampColumn('settled_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    unique('tournament_capture_admissions_id_round_unique').on(
      table.id,
      table.roundId,
    ),
    uniqueIndex('tournament_capture_admissions_round_unique').on(table.roundId),
    index('tournament_capture_admissions_room_idx').on(table.roomId),
    index('tournament_capture_admissions_lobby_idx').on(table.lobbyId),
    index('tournament_capture_admissions_fixture_idx').on(table.fixtureId),
    index('tournament_capture_admissions_sponsor_idx').on(table.sponsorUserId),
    index('tournament_capture_admissions_hosting_idx').on(
      table.hostingVersionId,
    ),
    index('tournament_capture_admissions_hosting_purchase_idx').on(
      table.hostingPurchaseId,
    ),
    check(
      'tournament_capture_admissions_one_basis',
      sql`(${table.hostingVersionId} is null) <> (${table.hostingPurchaseId} is null)`,
    ),
    index('tournament_capture_admissions_sponsorship_idx').on(
      table.sponsorshipVersionId,
      table.lobbyId,
    ),
    index('tournament_capture_admissions_official_user_idx').on(
      table.officialUserId,
    ),
    index('tournament_capture_admissions_official_actor_idx').on(
      table.officialActorId,
    ),
    index('tournament_capture_admissions_command_idx').on(table.commandId),
    index('tournament_capture_admissions_expired_idx')
      .on(table.deadlineAt, table.roundId)
      .where(sql`${table.settledAt} is null`),
    index('tournament_capture_admissions_unsettled_idx')
      .on(table.sponsorUserId, table.lobbyId, table.roundId)
      .where(sql`${table.settledAt} is null`),
    foreignKey({
      name: 'tournament_capture_admissions_sponsorship_fk',
      columns: [table.sponsorshipVersionId, table.lobbyId],
      foreignColumns: [
        tournamentSponsorshipVersions.id,
        tournamentSponsorshipVersions.lobbyId,
      ],
    }).onDelete('restrict'),
    jsonbIsObject('tournament_capture_admissions', table.admission),
    check(
      'tournament_capture_admissions_deadline_finite',
      sql`isfinite(${table.createdAt}) and isfinite(${table.deadlineAt}) and ${table.createdAt}<${table.deadlineAt} and (${table.settledAt} is null or (isfinite(${table.settledAt}) and ${table.settledAt}>=${table.createdAt}))`,
    ),
    check(
      'tournament_capture_admissions_identity',
      sql`coalesce(${table.admission}->>'id'=${table.id} and ${table.admission}->>'roundId'=${table.roundId} and ${table.admission}->>'roomId'=${table.roomId} and ${table.admission}->>'lobbyId'=${table.lobbyId} and ${table.admission}->>'fixtureId'=${table.fixtureId} and ${table.admission}->>'commandId'=${table.commandId} and case ${table.admission}->'basis'->>'kind' when 'grant' then ${table.admission}->'basis'->'grant'->'hosting'->>'id'=${table.hostingVersionId} and ${table.admission}->'basis'->'grant'->'hosting'->>'userId'=${table.sponsorUserId} when 'hosting-purchase' then ${table.admission}->'basis'->'purchase'->>'id'=${table.hostingPurchaseId} and ${table.admission}->'basis'->'purchase'->>'lobbyId'=${table.lobbyId} else false end and ${table.admission}->'official'->>'userId'=${table.officialUserId} and ${table.admission}->'official'->>'actorId'=${table.officialActorId} and (${table.admission}->>'admittedAt')::timestamptz=${table.createdAt} and (${table.admission}->>'deadlineAt')::timestamptz=${table.deadlineAt} and case ${table.admission}->'funding'->>'kind' when 'personal-owner' then ${table.sponsorshipVersionId} is null and ${table.admission}->'funding'->>'ownerUserId'=${table.sponsorUserId} when 'organization-sponsor' then ${table.sponsorshipVersionId} is not null and ${table.admission}->'funding'->>'sponsorshipVersionId'=${table.sponsorshipVersionId} else false end,false)`,
    ),
  ],
);
