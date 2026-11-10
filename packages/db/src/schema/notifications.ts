import { notificationChoicePairs, notificationKinds } from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { createdAtColumn, oneOf, timestampColumn } from './columns';
import { actors } from './actors';
import { challenges } from './challenges';
import { roomInvitations } from './room-invitations';
import { rounds } from './rounds';
import { users } from './users';

const watchKinds = sql.raw(`'followed_debater_live', 'recording_ready'`);

/**
 * A stored notification (WATCH-12, ADR 0124). There is no text, result or
 * score column, so an outcome cannot be stored in one: a row says what kind
 * of thing happened and names exactly the subject its kind requires (a
 * Round, a Room invitation or a challenge), and the words come from the
 * kind when it is read. `actor_id` is who it is about: the followed
 * debater, the inviting host or the challenger. Kept 90 days after read.
 */
export const notifications = pgTable(
  'notifications',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    roundId: text('round_id').references(() => rounds.id, {
      onDelete: 'cascade',
    }),
    roomInvitationId: text('room_invitation_id').references(
      () => roomInvitations.id,
      { onDelete: 'cascade' },
    ),
    challengeId: text('challenge_id').references(() => challenges.id, {
      onDelete: 'cascade',
    }),
    actorId: text('actor_id').references(() => actors.id, {
      onDelete: 'cascade',
    }),
    readAt: timestampColumn('read_at'),
    createdAt: createdAtColumn(),
  },
  (table) => [
    uniqueIndex('notifications_round_once')
      .on(table.userId, table.kind, table.roundId)
      .where(sql`${table.roundId} is not null`),
    uniqueIndex('notifications_invitation_once').on(table.roomInvitationId),
    uniqueIndex('notifications_challenge_once').on(table.challengeId),
    index('notifications_user_idx').on(
      table.userId,
      table.createdAt.desc(),
      table.id.desc(),
    ),
    index('notifications_read_idx')
      .on(table.readAt)
      .where(sql`${table.readAt} is not null`),
    index('notifications_round_idx').on(table.roundId),
    index('notifications_actor_idx').on(table.actorId),
    check('notifications_kind_check', oneOf(table.kind, notificationKinds)),
    check(
      'notifications_subject_check',
      sql`(${table.kind} in (${watchKinds})) = (${table.roundId} is not null)
        and (${table.kind} = 'room_invitation') = (${table.roomInvitationId} is not null)
        and (${table.kind} = 'challenge_received') = (${table.challengeId} is not null)`,
    ),
    check(
      'notifications_actor_check',
      sql`(${table.kind} = 'recording_ready') = (${table.actorId} is null)`,
    ),
  ],
);

const choicePairs = sql.raw(
  notificationChoicePairs
    .map(({ kind, channel }) => `('${kind}', '${channel}')`)
    .join(', '),
);

/** What a member has turned off, per kind and channel. A pair with no row is on. */
export const notificationPreferences = pgTable(
  'notification_preferences',
  {
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    channel: text('channel').notNull(),
    enabled: boolean('enabled').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.userId, table.kind, table.channel] }),
    check(
      'notification_preferences_pair_check',
      sql`(${table.kind}, ${table.channel}) in (${choicePairs})`,
    ),
  ],
);

/**
 * One event of one Round has told everyone it was going to. Notifications reads
 * Broadcast and Recording as named inputs and writes nothing to them, so the
 * sweep's memory of what it has done lives here.
 */
export const notificationFanouts = pgTable(
  'notification_fanouts',
  {
    kind: text('kind').notNull(),
    roundId: text('round_id')
      .notNull()
      .references(() => rounds.id, { onDelete: 'cascade' }),
    createdAt: createdAtColumn(),
  },
  (table) => [
    primaryKey({ columns: [table.kind, table.roundId] }),
    index('notification_fanouts_round_idx').on(table.roundId),
    check(
      'notification_fanouts_kind_check',
      sql`${table.kind} in (${watchKinds})`,
    ),
  ],
);

export const notificationEmailStates = [
  'queued',
  'leased',
  'sent',
  'failed',
  'cancelled',
] as const;
export const notificationEmailErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'recipient-gone',
  'not-owed',
  'preference-off',
  'rate-limited',
  'unconfigured',
] as const;

/**
 * One notification's email, owed when the notification was written with the
 * member's email channel on (ADR 0124). An auditable job: claimed under a
 * lease, retried with backoff, ending sent, failed or cancelled. It holds no
 * address or body; both are read at send time, so a withdrawn invitation or
 * an erased member is cancelled, never sent. `id` is the provider
 * idempotency key. The notification may go first (a challenge ends); the
 * job keeps its kind and recipient until retention deletes it.
 */
export const notificationEmails = pgTable(
  'notification_emails',
  {
    id: text('id').primaryKey(),
    notificationId: text('notification_id')
      .unique()
      .references(() => notifications.id, { onDelete: 'set null' }),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    state: text('state').notNull(),
    attempts: integer('attempts').notNull(),
    leaseTokenDigest: text('lease_token_digest'),
    leaseExpiresAt: timestampColumn('lease_expires_at'),
    nextAttemptAt: timestampColumn('next_attempt_at').notNull(),
    lastErrorCode: text('last_error_code'),
    createdAt: createdAtColumn(),
    completedAt: timestampColumn('completed_at'),
  },
  (table) => [
    index('notification_emails_due_idx').on(table.state, table.nextAttemptAt),
    index('notification_emails_user_idx').on(table.userId, table.completedAt),
    index('notification_emails_completed_idx').on(table.completedAt),
    check(
      'notification_emails_kind_check',
      sql`${table.kind} in ('room_invitation', 'challenge_received')`,
    ),
    check(
      'notification_emails_state_check',
      oneOf(table.state, notificationEmailStates),
    ),
    check('notification_emails_attempts_check', sql`${table.attempts} >= 0`),
    check(
      'notification_emails_lease_check',
      sql`(${table.state} = 'leased') = (${table.leaseTokenDigest} is not null and ${table.leaseExpiresAt} is not null) and (${table.leaseTokenDigest} is null or ${table.leaseTokenDigest} ~ '^[0-9a-f]{64}$')`,
    ),
    check(
      'notification_emails_completed_check',
      sql`(${table.state} in ('sent', 'failed', 'cancelled')) = (${table.completedAt} is not null)`,
    ),
    check(
      'notification_emails_error_check',
      sql`${table.lastErrorCode} is null or ${oneOf(table.lastErrorCode, notificationEmailErrorCodes)}`,
    ),
  ],
);
