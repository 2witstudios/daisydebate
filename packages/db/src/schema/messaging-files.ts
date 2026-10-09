import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  foreignKey,
  index,
  pgTable,
  text,
  unique,
} from 'drizzle-orm/pg-core';
import { actors } from './actors';
import { messagingChannels } from './messaging-channels';
import { messagingMessages } from './messaging-messages';
import { oneOf, timestampColumn } from './columns';

/** Quota remains charged while deletion is pending; only vendor acknowledgement releases it. */
export const messagingFiles = pgTable(
  'messaging_files',
  {
    id: text('id').primaryKey(),
    channelId: text('channel_id')
      .notNull()
      .references(() => messagingChannels.id, { onDelete: 'restrict' }),
    ownerActorId: text('owner_actor_id')
      .notNull()
      .references(() => actors.id, { onDelete: 'restrict' }),
    requestId: text('request_id'),
    messageId: text('message_id'),
    objectKey: text('object_key').notNull(),
    filename: text('filename'),
    mime: text('mime'),
    reservedBytes: bigint('reserved_bytes', { mode: 'number' }).notNull(),
    storedBytes: bigint('stored_bytes', { mode: 'number' }),
    generation: bigint('generation', { mode: 'number' }).notNull(),
    authorityRevision: bigint('authority_revision', {
      mode: 'number',
    }).notNull(),
    lifecycle: text('lifecycle').notNull(),
    createdAt: timestampColumn('created_at').notNull(),
    expiresAt: timestampColumn('expires_at').notNull(),
    deletedAt: timestampColumn('deleted_at'),
  },
  (t) => [
    index('messaging_files_owner_idx').on(t.ownerActorId),
    index('messaging_files_channel_idx').on(t.channelId),
    index('messaging_files_message_idx').on(t.messageId, t.channelId),
    index('messaging_files_cleanup_idx').on(t.lifecycle, t.expiresAt),
    unique('messaging_files_request_unique').on(
      t.ownerActorId,
      t.channelId,
      t.requestId,
    ),
    unique('messaging_files_object_unique').on(t.objectKey),
    foreignKey({
      name: 'messaging_files_message_channel_fk',
      columns: [t.messageId, t.channelId],
      foreignColumns: [messagingMessages.id, messagingMessages.channelId],
    }),
    check(
      'messaging_files_lifecycle',
      oneOf(t.lifecycle, [
        'reserved',
        'quarantined',
        'attached',
        'deleting',
        'deleted',
      ]),
    ),
    check(
      'messaging_files_bytes',
      sql`${t.reservedBytes} between 1 and 9007199254740991 and (${t.storedBytes} is null or ${t.storedBytes} between 1 and ${t.reservedBytes})`,
    ),
    check(
      'messaging_files_generation',
      sql`${t.generation} between 1 and 9007199254740991 and ${t.authorityRevision} between 1 and 9007199254740991`,
    ),
    check(
      'messaging_files_times',
      sql`${t.expiresAt} > ${t.createdAt} and (${t.deletedAt} is null or ${t.deletedAt} >= ${t.createdAt})`,
    ),
    check(
      'messaging_files_metadata',
      sql`(${t.lifecycle} in ('reserved','quarantined','attached') and ${t.filename} is not null and ${t.filename} ~ '[^[:space:]]' and ${t.mime} is not null and ${t.mime} in ('image/png','image/jpeg','image/webp','application/pdf') and ${t.requestId} is not null and ${t.deletedAt} is null) or (${t.lifecycle} in ('deleting','deleted') and ${t.filename} is null and ${t.mime} is null and ${t.requestId} is null and ${t.messageId} is null)`,
    ),
    check(
      'messaging_files_association',
      sql`(${t.lifecycle} = 'attached' and ${t.messageId} is not null and ${t.storedBytes} is not null) or (${t.lifecycle} <> 'attached' and ${t.messageId} is null)`,
    ),
    check(
      'messaging_files_ack',
      sql`(${t.lifecycle} = 'deleted') = (${t.deletedAt} is not null)`,
    ),
  ],
);
