import type { MessagingMessageRecord } from '@daisy/db/messaging';

export function messagingMessageView(message: MessagingMessageRecord) {
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
