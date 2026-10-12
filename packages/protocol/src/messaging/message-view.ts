import { z } from 'zod';
import { idSchema } from '../primitives';
const order = z.number().int().positive().safe();
const iso = z.iso.datetime();
/** Restricted current message row: shape only; text bounds belong to the owning policy. */
export const messagingMessageRecordSchema = z.strictObject({
  id: idSchema,
  channelId: idSchema,
  authorActorId: idSchema,
  sequence: order,
  changeVersion: order,
  text: z.string().nullable(),
  createdAt: iso,
  editedAt: iso.nullable(),
  removedAt: iso.nullable(),
  replyToMessageId: idSchema.optional(),
});
type MessageProjectionRecord = z.infer<typeof messagingMessageRecordSchema>;

export function messagingMessageView(message: MessageProjectionRecord) {
  const { id, channelId, sequence, changeVersion } = message;
  if (message.text === null || message.removedAt !== null)
    return {
      id,
      channelId,
      sequence,
      changeVersion,
      unavailable: true as const,
    };
  return {
    id,
    channelId,
    sequence,
    changeVersion,
    authorActorId: message.authorActorId,
    text: message.text,
    createdAt: message.createdAt,
    editedAt: message.editedAt,
    ...(message.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: message.replyToMessageId }),
  };
}
