import { invalidateChannelInboxes } from './inbox-change';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messageRecord } from './message-record';
import { channelReadFrame } from './read-frame';
import { channelMutationFrame } from './mutation-frame';
import { appendStream } from './stream';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import type {
  MessagingLockedFrame,
  MessagingMessageRecord,
  MessagingSendCommand,
} from './records';

type ReadTransaction = Pick<BunSQLDatabase, 'select'>;
export const readMessageIn =
  (tx: ReadTransaction, channelId: string) =>
  async (messageId: string | null): Promise<MessagingMessageRecord | null> => {
    if (messageId === null) return null;
    const [row] = await tx
      .select()
      .from(messagingMessages)
      .where(
        and(
          eq(messagingMessages.id, messageId),
          eq(messagingMessages.channelId, channelId),
        ),
      );
    return row ? messageRecord(row) : null;
  };
/** The actor's own receipt for one request key, if any. */
export const readReceipt = async (
  tx: ReadTransaction,
  scope: { readonly channelId: string; readonly actorId: string },
  requestId: string,
) => {
  const [receipt] = await tx
    .select({
      payloadDigest: messagingReceipts.payloadDigest,
      messageId: messagingReceipts.messageId,
    })
    .from(messagingReceipts)
    .where(
      and(
        eq(messagingReceipts.channelId, scope.channelId),
        eq(messagingReceipts.actorId, scope.actorId),
        eq(messagingReceipts.requestId, requestId),
      ),
    );
  return receipt ?? null;
};

/** Shared Messaging content methods; the owning producer supplies its current authority fence. */
export function messagingContentFrame(
  tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>,
  input: { readonly channelId: string; readonly actorId: string },
  counters: {
    channelId: string;
    messageSequence: number;
    changeVersion: number;
  },
  refreshAuthorization: () => Promise<void>,
): Omit<MessagingLockedFrame, 'fact' | 'accounts'> {
  let command: MessagingSendCommand | null = null;
  const readMessage = readMessageIn(tx, input.channelId);
  return {
    authorize: refreshAuthorization,
    counters,
    ...channelReadFrame(tx, input, counters, refreshAuthorization),
    ...channelMutationFrame(
      tx,
      input,
      counters,
      refreshAuthorization,
      readMessage,
    ),
    async readSendState(send) {
      await refreshAuthorization();
      if (
        send.channelId !== input.channelId ||
        !idSchema.safeParse(send.requestId).success
      )
        throw createAppError('VALIDATION');
      command = send;
      const receipt = await readReceipt(tx, input, send.requestId);
      return {
        counters,
        receipt,
        existingMessage: receipt ? await readMessage(receipt.messageId) : null,
        reply: await readMessage(send.replyToMessageId ?? null),
      };
    },
    async commitSend(plan) {
      await refreshAuthorization();
      if (!command) throw createAppError('CONFLICT');
      if (
        ![
          plan.message.channelId === input.channelId,
          plan.message.authorActorId === input.actorId,
          plan.message.sequence === counters.messageSequence + 1,
          plan.message.changeVersion === counters.changeVersion + 1,
          plan.message.text === command.text,
          plan.message.replyToMessageId === command.replyToMessageId,
          plan.receipt.messageId === plan.message.id,
        ].every(Boolean)
      )
        throw createAppError('CONFLICT');
      const allocated = await appendStream(tx, input.channelId, {
        messages: 1,
        changes: 1,
      });
      if (
        allocated.messageSequence !== plan.message.sequence ||
        allocated.changeVersion !== plan.message.changeVersion
      )
        throw createAppError('CONFLICT');
      await tx.insert(messagingMessages).values({
        ...plan.message,
        createdAt: new Date(plan.message.createdAt),
        editedAt: null,
        removedAt: null,
      });
      await tx.insert(messagingReceipts).values({
        channelId: input.channelId,
        actorId: input.actorId,
        requestId: command.requestId,
        ...plan.receipt,
      });
      await invalidateChannelInboxes(tx, input.channelId);
      counters.messageSequence = plan.message.sequence;
      counters.changeVersion = plan.message.changeVersion;
    },
  };
}
