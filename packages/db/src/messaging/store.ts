import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic, idSchema } from '@daisy/protocol';
import { withMessagingChannel } from './channel-frame';
import { messageRecord } from './message-record';
import { channelReadFrame } from './read-frame';
import { channelMutationFrame } from './mutation-frame';
import { appendOutboxEvent } from '../outbox';
import { messagingChannels } from '../schema/messaging-channels';
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

/** Scope-specific transaction frame; never exposes a raw database to delivery. */
export function createMessagingStore({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingAuthorizationFence;
}): MessagingChannelStore {
  return {
    withChannel: async (input, work) => {
      return withMessagingChannel(
        database,
        input,
        async ({ tx, channel, fact, accounts }) => {
          const counters = {
            channelId: channel.id,
            messageSequence: channel.messageSequence,
            changeVersion: channel.changeVersion,
          };
          const refreshAuthorization = () =>
            authorize(tx, input, { fact, accounts });
          let command: MessagingSendCommand | null = null;
          const readMessage = async (
            messageId: string | null,
          ): Promise<MessagingMessageRecord | null> => {
            if (messageId === null) return null;
            const [row] = await tx
              .select()
              .from(messagingMessages)
              .where(
                and(
                  eq(messagingMessages.id, messageId),
                  eq(messagingMessages.channelId, channel.id),
                ),
              );
            return row ? messageRecord(row) : null;
          };
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
              const [receipt] = await tx
                .select({
                  payloadDigest: messagingReceipts.payloadDigest,
                  messageId: messagingReceipts.messageId,
                })
                .from(messagingReceipts)
                .where(
                  and(
                    eq(messagingReceipts.channelId, channel.id),
                    eq(messagingReceipts.actorId, input.actorId),
                    eq(messagingReceipts.requestId, send.requestId),
                  ),
                );
              return {
                counters,
                receipt: receipt ?? null,
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
              await tx
                .update(messagingChannels)
                .set({
                  messageSequence: plan.message.sequence,
                  changeVersion: plan.message.changeVersion,
                })
                .where(eq(messagingChannels.id, channel.id));
              await appendOutboxEvent(tx, {
                topic: buildChannelTopic(channel.id),
                kind: 'channel.changed',
                version: 1,
                payload: plan.doorbell,
              });
              counters.messageSequence = plan.message.sequence;
              counters.changeVersion = plan.message.changeVersion;
            },
          });
        },
      );
    },
  };
}
