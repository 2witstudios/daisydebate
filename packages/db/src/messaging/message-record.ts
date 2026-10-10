import { messagingMessages } from '../schema/messaging-messages';
import type { MessagingMessageRecord } from './records';
export const messageRecord = (
  row: typeof messagingMessages.$inferSelect,
): MessagingMessageRecord => ({
  id: row.id,
  channelId: row.channelId,
  authorActorId: row.authorActorId,
  sequence: row.sequence,
  changeVersion: row.changeVersion,
  text: row.text,
  createdAt: row.createdAt.toISOString(),
  editedAt: row.editedAt?.toISOString() ?? null,
  removedAt: row.removedAt?.toISOString() ?? null,
  ...(row.replyToMessageId === null
    ? {}
    : { replyToMessageId: row.replyToMessageId }),
});
