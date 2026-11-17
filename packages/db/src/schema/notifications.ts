import {
  kindsAbout,
  notificationChoicePairs,
  notificationKinds,
  notificationSubjects,
  type NotificationSubjectKind,
} from '@daisy/protocol';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import {
  createdAtColumn,
  mailJobChecks,
  mailJobColumns,
  oneOf,
  timestampColumn,
} from './columns';
import { actors } from './actors';
import { challenges } from './challenges';
import { friendships } from './friends';
import { roomInvitations } from './room-invitations';
import { rounds } from './rounds';
import { users } from './users';

/**
 * The stored columns that name each subject: the one place a subject meets
 * its columns, read by the subject check and by the writer (ADR 0144).
 */
export const notificationSubjectColumns = {
  round: ['round_id'],
  room_invitation: ['room_invitation_id'],
  challenge: ['challenge_id'],
  friendship: ['friendship_low_actor_id', 'friendship_high_actor_id'],
} as const satisfies Record<NotificationSubjectKind, readonly string[]>;

/** A row names exactly the subject its kind requires, and no other. */
const subjectCheck = sql.raw(
  notificationSubjects
    .flatMap((subject) =>
      notificationSubjectColumns[subject].map(
        (column) =>
          `("kind" in (${kindsAbout(subject)
            .map((kind) => `'${kind}'`)
            .join(', ')})) = ("${column}" is not null)`,
      ),
    )
    .join(' and '),
);

/** The kinds Watch's fan-out writes from released Round facts (WATCH-12). */
const watchFanoutKinds = sql.raw(`'followed_debater_live', 'recording_ready'`);

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
    /** The friendship asked or accepted; it goes when the friendship does. */
    friendshipLowActorId: text('friendship_low_actor_id'),
    friendshipHighActorId: text('friendship_high_actor_id'),
    actorId: text('actor_id').references(() => actors.id, {
      onDelete: 'cascade',
    }),
    /** The member's batched email this one is gathered into, if any. */
    digestId: text('digest_id').references(() => notificationDigests.id, {
      onDelete: 'set null',
    }),
    readAt: timestampColumn('read_at'),
    createdAt: createdAtColumn(),
    /** When it last reached the member: written, or brought back unread. */
    surfacedAt: timestampColumn('surfaced_at').notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('notifications_round_once')
      .on(table.userId, table.kind, table.roundId)
      .where(sql`${table.roundId} is not null`),
    uniqueIndex('notifications_invitation_once').on(table.roomInvitationId),
    uniqueIndex('notifications_challenge_once')
      .on(table.userId, table.kind, table.challengeId)
      .where(sql`${table.challengeId} is not null`),
    index('notifications_user_idx').on(
      table.userId,
      table.surfacedAt.desc(),
      table.id.desc(),
    ),
    index('notifications_read_idx')
      .on(table.readAt)
      .where(sql`${table.readAt} is not null`),
    index('notifications_round_idx').on(table.roundId),
    index('notifications_challenge_idx').on(table.challengeId),
    index('notifications_digest_idx').on(table.digestId),
    index('notifications_actor_idx').on(table.actorId),
    check('notifications_kind_check', oneOf(table.kind, notificationKinds)),
    uniqueIndex('notifications_friendship_once')
      .on(
        table.userId,
        table.kind,
        table.friendshipLowActorId,
        table.friendshipHighActorId,
      )
      .where(sql`${table.friendshipLowActorId} is not null`),
    index('notifications_friendship_idx').on(
      table.friendshipLowActorId,
      table.friendshipHighActorId,
    ),
    foreignKey({
      name: 'notifications_friendship_fk',
      columns: [table.friendshipLowActorId, table.friendshipHighActorId],
      foreignColumns: [friendships.lowActorId, friendships.highActorId],
    }).onDelete('cascade'),
    check('notifications_subject_check', subjectCheck),
    check(
      'notifications_actor_check',
      // These are about a Round alone: nobody in particular brought them.
      sql`(${oneOf(table.kind, ['recording_ready', 'round_started'])}) = (${table.actorId} is null)`,
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
      sql`${table.kind} in (${watchFanoutKinds})`,
    ),
  ],
);

export const notificationDigestErrorCodes = [
  'delivery',
  'delivery-unknown',
  'suppressed',
  'recipient-gone',
  'not-owed',
  'unconfigured',
] as const;

/**
 * One member's batched email (ADR 0144): every emailed notification owed
 * while it is queued links to it, and each one pushes its send back to a
 * quiet time after it, never past a longest wait after the first. An
 * auditable job on the shared mail recipe: claimed under a lease, retried
 * with backoff, ending sent, failed or cancelled. It holds no address or
 * body; at send time it re-reads which of its notifications are unread,
 * still stand and are still wanted by email, and is cancelled `not-owed`
 * when none are. At most one is queued per member; one owed while another
 * is being sent starts the next. `id` is the provider idempotency key.
 */
export const notificationDigests = pgTable(
  'notification_digests',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** When its first notification was owed: the longest wait counts from here. */
    firstOwedAt: timestampColumn('first_owed_at').notNull(),
    ...mailJobColumns(),
  },
  (table) => [
    uniqueIndex('notification_digests_one_queued')
      .on(table.userId)
      .where(sql`${table.state} = 'queued'`),
    index('notification_digests_due_idx').on(table.state, table.nextAttemptAt),
    index('notification_digests_user_idx').on(table.userId, table.completedAt),
    index('notification_digests_completed_idx').on(table.completedAt),
    ...mailJobChecks(
      'notification_digests',
      table,
      notificationDigestErrorCodes,
    ),
  ],
);

/**
 * How a member is told while Daisy is open, and whether Daisy emails them
 * at all (ADR 0144). A member with no row has everything on. The inbox and
 * its badges never depend on it: these choose only how a stored notification
 * is presented, or whether any is emailed.
 */
export const notificationPresentation = pgTable('notification_presentation', {
  userId: text('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  toasts: boolean('toasts').notNull(),
  sound: boolean('sound').notNull(),
  desktopAlerts: boolean('desktop_alerts').notNull(),
  email: boolean('email').notNull(),
});
