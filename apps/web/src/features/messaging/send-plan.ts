import { createHash } from 'node:crypto';
import { createAppError } from '@daisy/errors';

import type {
  MessagingSendCommand,
  MessagingMessageRecord,
  MessagingSendState,
} from '@daisy/db/messaging';

/** Ordered fields, original text, no JSON property-order dependency. Never log it. */
export function sendPayloadDigest(command: MessagingSendCommand): string {
  return createHash('sha3-256')
    .update(
      JSON.stringify([
        command.version,
        command.text,
        command.replyToMessageId ?? null,
      ]),
    )
    .digest('hex');
}

function availableMessage(
  message: MessagingMessageRecord | null,
  channelId: string,
  messageId: string | null,
): MessagingMessageRecord {
  if (!message) throw createAppError('NOT_FOUND');
  if (
    ![
      message.id === messageId,
      message.channelId === channelId,
      message.text !== null,
      message.removedAt === null,
    ].every(Boolean)
  )
    throw createAppError('NOT_FOUND');
  return message;
}

function nextCounters(state: MessagingSendState) {
  const sequence = state.counters.messageSequence + 1;
  const changeVersion = state.counters.changeVersion + 1;
  if (
    ![
      Number.isSafeInteger(sequence),
      Number.isSafeInteger(changeVersion),
      sequence >= 1,
      changeVersion >= sequence,
    ].every(Boolean)
  )
    throw createAppError('CONFLICT');
  return { sequence, changeVersion };
}

/**
 * Pure persistence plan. The operation must authorize CURRENT facts before
 * invoking this, including equal retries. A receipt carries no stored body.
 */
export function planMessageSend(
  command: MessagingSendCommand,
  state: MessagingSendState,
  resources: {
    readonly actorId: string;
    readonly messageId: string;
    readonly now: string;
  },
) {
  if (command.channelId !== state.counters.channelId)
    throw createAppError('NOT_FOUND');
  const payloadDigest = sendPayloadDigest(command);
  if (state.receipt) {
    const message = availableMessage(
      state.existingMessage,
      command.channelId,
      state.receipt.messageId,
    );
    if (message.authorActorId !== resources.actorId)
      throw createAppError('NOT_FOUND');
    if (state.receipt.payloadDigest !== payloadDigest)
      throw createAppError('CONFLICT');
    return { kind: 'replay' as const, message };
  }
  if (command.replyToMessageId !== undefined)
    availableMessage(state.reply, command.channelId, command.replyToMessageId);
  const { sequence, changeVersion } = nextCounters(state);
  const message: MessagingMessageRecord = {
    id: resources.messageId,
    channelId: command.channelId,
    authorActorId: resources.actorId,
    sequence,
    changeVersion,
    text: command.text,
    createdAt: resources.now,
    editedAt: null,
    removedAt: null,
    ...(command.replyToMessageId === undefined
      ? {}
      : { replyToMessageId: command.replyToMessageId }),
  };
  return {
    kind: 'create' as const,
    message,
    receipt: { payloadDigest, messageId: message.id },
    doorbell: {
      kind: 'channel.changed' as const,
      channelId: command.channelId,
      changeVersion,
    },
  };
}
