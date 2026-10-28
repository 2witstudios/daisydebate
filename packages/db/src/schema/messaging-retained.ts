import { index, pgTable, primaryKey } from 'drizzle-orm/pg-core';
import { timestampColumn } from './columns';
import {
  messagingActorColumn,
  messagingChannelColumn,
} from './messaging-columns';
import { messagingChannels } from './messaging-channels';

/**
 * DEC-126: the survivor of an erased DM member, and their only grant to the
 * channel it left behind (lifecycle `retained`). Written only by erasure,
 * never derived from authorship; deleted when the survivor deletes the
 * conversation or is erased, and the channel goes once none remains.
 */
export const messagingRetainedAuthors = pgTable(
  'messaging_retained_authors',
  {
    channelId: messagingChannelColumn(() => messagingChannels.id),
    actorId: messagingActorColumn('actor_id'),
    createdAt: timestampColumn('created_at').notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.channelId, table.actorId] }),
    index('messaging_retained_authors_actor_idx').on(table.actorId),
  ],
);
