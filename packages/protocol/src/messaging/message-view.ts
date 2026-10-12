type MessageProjectionRecord = {
  readonly id: string;
  readonly channelId: string;
  readonly authorActorId: string;
  readonly sequence: number;
  readonly changeVersion: number;
  readonly text: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly removedAt: string | null;
  readonly replyToMessageId?: string | undefined;
};

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
