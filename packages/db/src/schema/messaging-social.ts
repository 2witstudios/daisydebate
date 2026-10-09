import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  index,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { messagingActorColumn } from './messaging-columns';
import { oneOf, timestampColumn } from './columns';
import { messagingChannels } from './messaging-channels';

/** One durable lock target even when a blocked pair has no DM channel. */
export const messagingContactPairs = pgTable(
  'messaging_contact_pairs',
  {
    lowActorId: messagingActorColumn('low_actor_id'),
    highActorId: messagingActorColumn('high_actor_id'),
    lowBlocksHigh: boolean('low_blocks_high').notNull().default(false),
    highBlocksLow: boolean('high_blocks_low').notNull().default(false),
    revision: bigint('revision', { mode: 'number' }).notNull().default(1),
  },
  (table) => [
    index('messaging_contact_pairs_high_actor_idx').on(table.highActorId),
    primaryKey({ columns: [table.lowActorId, table.highActorId] }),
    check(
      'messaging_contact_pairs_order',
      sql`${table.lowActorId} < ${table.highActorId}`,
    ),
    check(
      'messaging_contact_pairs_revision',
      sql`${table.revision} between 1 and 9007199254740991`,
    ),
  ],
);

/** Messaging's accepted/requested DM pair is not a friendship producer. */
export const messagingDmPairs = pgTable(
  'messaging_dm_pairs',
  {
    lowActorId: messagingActorColumn('low_actor_id'),
    highActorId: messagingActorColumn('high_actor_id'),
    channelId: text('channel_id').notNull(),
    channelKind: text('channel_kind').notNull().default('dm'),
    requestSenderActorId: text('request_sender_actor_id').notNull(),
    requestState: text('request_state').notNull(),
    introduction: text('introduction'),
    requestedAt: timestampColumn('requested_at').notNull(),
    decidedAt: timestampColumn('decided_at'),
  },
  (table) => [
    index('messaging_dm_pairs_high_actor_idx').on(table.highActorId),
    index('messaging_dm_pairs_channel_kind_idx').on(
      table.channelId,
      table.channelKind,
    ),
    primaryKey({ columns: [table.lowActorId, table.highActorId] }),
    unique('messaging_dm_pairs_channel_unique').on(table.channelId),
    check(
      'messaging_dm_pairs_order',
      sql`${table.lowActorId} < ${table.highActorId}`,
    ),
    check('messaging_dm_pairs_kind', sql`${table.channelKind} = 'dm'`),
    check(
      'messaging_dm_pairs_request_sender',
      sql`${table.requestSenderActorId} in (${table.lowActorId}, ${table.highActorId})`,
    ),
    check(
      'messaging_dm_pairs_request_state',
      oneOf(table.requestState, [
        'pending',
        'accepted',
        'declined',
        'cancelled',
      ]),
    ),
    check(
      'messaging_dm_pairs_request_time',
      sql`(${table.requestState} = 'pending' and ${table.decidedAt} is null) or (${table.requestState} <> 'pending' and ${table.decidedAt} is not null and ${table.decidedAt} >= ${table.requestedAt})`,
    ),
    foreignKey({
      name: 'messaging_dm_pairs_contact_fk',
      columns: [table.lowActorId, table.highActorId],
      foreignColumns: [
        messagingContactPairs.lowActorId,
        messagingContactPairs.highActorId,
      ],
    }),
    foreignKey({
      name: 'messaging_dm_pairs_channel_kind_fk',
      columns: [table.channelId, table.channelKind],
      foreignColumns: [messagingChannels.id, messagingChannels.kind],
    }).onDelete('cascade'),
  ],
);

export const messagingGroupGrants = pgTable(
  'messaging_group_grants',
  {
    channelId: text('channel_id').notNull(),
    channelKind: text('channel_kind').notNull().default('private_group'),
    actorId: messagingActorColumn('actor_id'),
    role: text('role').notNull(),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    grantedAt: timestampColumn('granted_at').notNull(),
    revokedAt: timestampColumn('revoked_at'),
  },
  (table) => [
    index('messaging_group_grants_actor_idx').on(table.actorId),
    index('messaging_group_grants_channel_kind_idx').on(
      table.channelId,
      table.channelKind,
    ),
    primaryKey({ columns: [table.channelId, table.actorId] }),
    check(
      'messaging_group_grants_kind',
      sql`${table.channelKind} = 'private_group'`,
    ),
    check(
      'messaging_group_grants_role',
      oneOf(table.role, ['manager', 'member']),
    ),
    check(
      'messaging_group_grants_time',
      sql`${table.revokedAt} is null or ${table.revokedAt} >= ${table.grantedAt}`,
    ),
    check(
      'messaging_group_grants_generation',
      sql`${table.generation} between 1 and 9007199254740991`,
    ),
    foreignKey({
      name: 'messaging_group_grants_channel_kind_fk',
      columns: [table.channelId, table.channelKind],
      foreignColumns: [messagingChannels.id, messagingChannels.kind],
    }).onDelete('cascade'),
  ],
);

/** Pending invitations convey no grant or readable channel history. */
export const messagingGroupInvitations = pgTable(
  'messaging_group_invitations',
  {
    channelId: text('channel_id').notNull(),
    channelKind: text('channel_kind').notNull().default('private_group'),
    inviteeActorId: messagingActorColumn('invitee_actor_id'),
    invitedByActorId: messagingActorColumn('invited_by_actor_id'),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    state: text('state').notNull(),
    invitedAt: timestampColumn('invited_at').notNull(),
    decidedAt: timestampColumn('decided_at'),
  },
  (table) => [
    index('messaging_group_invitations_invitee_idx').on(table.inviteeActorId),
    index('messaging_group_invitations_inviter_idx').on(table.invitedByActorId),
    index('messaging_group_invitations_channel_kind_idx').on(
      table.channelId,
      table.channelKind,
    ),
    primaryKey({ columns: [table.channelId, table.inviteeActorId] }),
    check(
      'messaging_group_invitations_kind',
      sql`${table.channelKind} = 'private_group'`,
    ),
    foreignKey({
      name: 'messaging_group_invitations_channel_kind_fk',
      columns: [table.channelId, table.channelKind],
      foreignColumns: [messagingChannels.id, messagingChannels.kind],
    }).onDelete('cascade'),
    check(
      'messaging_group_invitations_generation',
      sql`${table.generation} between 1 and 9007199254740991`,
    ),
    check(
      'messaging_group_invitations_state',
      oneOf(table.state, ['pending', 'accepted', 'declined', 'cancelled']),
    ),
    check(
      'messaging_group_invitations_time',
      sql`(${table.state} = 'pending' and ${table.decidedAt} is null) or (${table.state} <> 'pending' and ${table.decidedAt} >= ${table.invitedAt} and ${table.decidedAt} is not null)`,
    ),
    check(
      'messaging_group_invitations_distinct',
      sql`${table.inviteeActorId} <> ${table.invitedByActorId}`,
    ),
  ],
);

/** Durable timing/counting and dedupe for social commands, without a stored body. */
export const messagingSocialCommands = pgTable(
  'messaging_social_commands',
  {
    actorId: messagingActorColumn('actor_id'),
    requestId: text('request_id').notNull(),
    kind: text('kind').notNull(),
    digest: text('digest'),
    resultChannelId: text('result_channel_id').references(
      () => messagingChannels.id,
      { onDelete: 'set null' },
    ),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    index('messaging_social_commands_result_channel_idx').on(
      table.resultChannelId,
    ),
    primaryKey({ columns: [table.actorId, table.requestId] }),
    check(
      'messaging_social_commands_digest',
      sql`${table.digest} is null or ${table.digest} ~ '^[0-9a-f]{64}$'`,
    ),
    check(
      'messaging_social_commands_kind',
      oneOf(table.kind, [
        'dm.request',
        'dm.decide',
        'dm.block',
        'group.create',
        'group.invite',
        'group.decide',
        'group.remove',
        'group.leave',
        'group.transfer',
        'group.archive',
      ]),
    ),
  ],
);
