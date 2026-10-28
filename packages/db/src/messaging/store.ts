import { invalidateChannelInboxes } from './inbox-change';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic, idSchema } from '@daisy/protocol';
import { readMessagingChannel, withMessagingChannel } from './channel-frame';
import { messageRecord } from './message-record';
import { channelReadFrame } from './read-frame';
import { channelMutationFrame } from './mutation-frame';
import { appendOutboxEvent } from '../outbox';
import { appendStream } from './stream';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import type {
  MessagingAuthorizationFence,
  MessagingChannelStore,
  MessagingMessageRecord,
  MessagingSendCommand,
} from './records';

type ReadTransaction = Pick<BunSQLDatabase, 'select'>;
const readMessageIn =
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
const readReceipt = async (
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

/** Scope-specific transaction frame; never exposes a raw database to delivery. */
export function createMessagingStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingAuthorizationFence;
}): MessagingChannelStore {
  return {
    readChannel: (input, work) =>
      readMessagingChannel(
        database,
        input,
        ({ tx, channel, stream, fact, accounts }) => {
          const authorizeRead = () => authorize(tx, input, { fact, accounts });
          const { history, changes } = channelReadFrame(
            tx,
            input,
            { channelId: channel.id, ...stream },
            authorizeRead,
          );
          return work({
            history,
            changes,
            authorize: authorizeRead,
            fact,
            accounts,
            async readRequestState({ requestId, messageId }) {
              await authorizeRead();
              if (
                !idSchema.safeParse(requestId).success ||
                (messageId !== undefined &&
                  !idSchema.safeParse(messageId).success)
              )
                throw createAppError('VALIDATION');
              return {
                counters: { channelId: channel.id, ...stream },
                receipt: await readReceipt(tx, input, requestId),
                message: await readMessageIn(tx, channel.id)(messageId ?? null),
              };
            },
          });
        },
      ),
    withChannel: async (input, work) => {
      return withMessagingChannel(
        database,
        input,
        async ({ tx, channel, stream, fact, accounts }) => {
          const counters = { channelId: channel.id, ...stream };
          const refreshAuthorization = () =>
            authorize(tx, input, { fact, accounts });
          let command: MessagingSendCommand | null = null;
          const readMessage = readMessageIn(tx, channel.id);
          return work({
            authorize: refreshAuthorization,
            fact,
            accounts,
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
                send.channelId !== channel.id ||
                !idSchema.safeParse(send.requestId).success
              )
                throw createAppError('VALIDATION');
              command = send;
              const receipt = await readReceipt(tx, input, send.requestId);
              return {
                counters,
                receipt,
                existingMessage: receipt
                  ? await readMessage(receipt.messageId)
                  : null,
                reply: await readMessage(send.replyToMessageId ?? null),
              };
            },
            async commitSend(plan) {
              await refreshAuthorization();
              if (!command) throw createAppError('CONFLICT');
              if (
                ![
                  plan.message.channelId === channel.id,
                  plan.message.authorActorId === input.actorId,
                  plan.message.sequence === counters.messageSequence + 1,
                  plan.message.changeVersion === counters.changeVersion + 1,
                  plan.message.text === command.text,
                  plan.message.replyToMessageId === command.replyToMessageId,
                  plan.receipt.messageId === plan.message.id,
                  plan.doorbell.channelId === channel.id,
                  plan.doorbell.changeVersion === plan.message.changeVersion,
                ].every(Boolean)
              )
                throw createAppError('CONFLICT');
              const allocated = await appendStream(tx, channel.id, {
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
                channelId: channel.id,
                actorId: input.actorId,
                requestId: command.requestId,
                ...plan.receipt,
              });
              await appendOutboxEvent(tx, {
                topic: buildChannelTopic(channel.id),
                kind: 'channel.changed',
                version: 1,
                payload: plan.doorbell,
              });
              await invalidateChannelInboxes(tx, channel.id);
              counters.messageSequence = plan.message.sequence;
              counters.changeVersion = plan.message.changeVersion;
            },
          });
        },
      );
    },
  };
}
