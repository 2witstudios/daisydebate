import { text, type AnyPgColumn } from 'drizzle-orm/pg-core';
import { actors } from './actors';

export const messagingActorColumn = (name: string) =>
  text(name)
    .notNull()
    .references(() => actors.id, { onDelete: 'restrict' });
export const messagingChannelColumn = (channel: () => AnyPgColumn) =>
  text('channel_id').notNull().references(channel, { onDelete: 'cascade' });
