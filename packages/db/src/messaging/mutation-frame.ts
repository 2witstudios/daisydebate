import { deleteMessageFiles } from '../messaging-files';
import { and, eq } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic } from '@daisy/protocol';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import { messagingChannels } from '../schema/messaging-channels';
import { appendOutboxEvent } from '../outbox';
import type {
  MessagingLockedFrame,
  MessagingMessageRecord,
  MessagingMutationCommand,
} from './records';

/** Current authority is rechecked before reading retry state and before writing. */
export function channelMutationFrame(
  tx: Pick<BunSQLDatabase, 'select' | 'insert' | 'update' | 'execute'>,
  input: { readonly actorId: string; readonly channelId: string },
  counters: {
    channelId: string;
    messageSequence: number;
    changeVersion: number;
  },
  authorize: () => Promise<void>,
  readMessage: (id: string) => Promise<MessagingMessageRecord | null>,
): Pick<MessagingLockedFrame, 'readMutationState' | 'commitMutation'> {
  let command: MessagingMutationCommand | null = null;
  let original: MessagingMessageRecord | null = null;
  return {
    async readMutationState(next) {
      await authorize();
      if (next.channelId !== input.channelId) throw createAppError('NOT_FOUND');
      command = next;
      original = await readMessage(next.messageId);
      const [receipt] = await tx
        .select({
          payloadDigest: messagingReceipts.payloadDigest,
          messageId: messagingReceipts.messageId,
        })
        .from(messagingReceipts)
        .where(
          and(
            eq(messagingReceipts.channelId, input.channelId),
            eq(messagingReceipts.actorId, input.actorId),
            eq(messagingReceipts.requestId, next.requestId),
          ),
        );
      return { message: original, receipt: receipt ?? null, counters };
    },
    async commitMutation(plan) {
      await authorize();
      if (
        !command ||
        !original ||
        ![
          original.authorActorId === input.actorId,
          original.text !== null,
          original.removedAt === null,
          plan.message.id === original.id,
          plan.message.channelId === input.channelId,
          plan.message.authorActorId === original.authorActorId,
          plan.message.createdAt === original.createdAt,
          plan.message.sequence === original.sequence,
          plan.message.changeVersion === counters.changeVersion + 1,
          plan.doorbell.channelId === input.channelId,
          plan.doorbell.changeVersion === plan.message.changeVersion,
          command.kind === 'remove'
            ? [
                plan.message.text === null,
                plan.message.removedAt !== null,
              ].every(Boolean)
            : [
                plan.message.text === command.text,
                plan.message.removedAt === null,
              ].every(Boolean),
        ].every(Boolean)
      )
        throw createAppError('CONFLICT');
      await tx
        .update(messagingMessages)
        .set({
          text: plan.message.text,
          changeVersion: plan.message.changeVersion,
          editedAt:
            plan.message.editedAt === null
              ? null
              : new Date(plan.message.editedAt),
          removedAt:
            plan.message.removedAt === null
              ? null
              : new Date(plan.message.removedAt),
        })
        .where(
          and(
            eq(messagingMessages.id, original.id),
            eq(messagingMessages.channelId, input.channelId),
          ),
        );
      await tx.insert(messagingReceipts).values({
        channelId: input.channelId,
        actorId: input.actorId,
        requestId: command.requestId,
        messageId: original.id,
        payloadDigest: command.kind === 'remove' ? null : plan.payloadDigest,
      });
      if (command.kind === 'remove') {
        await deleteMessageFiles(tx, {
          channelId: input.channelId,
          messageId: original.id,
        });
        await tx
          .update(messagingReceipts)
          .set({ payloadDigest: null })
          .where(
            and(
              eq(messagingReceipts.channelId, input.channelId),
              eq(messagingReceipts.messageId, original.id),
            ),
          );
      }
      await tx
        .update(messagingChannels)
        .set({ changeVersion: plan.message.changeVersion })
        .where(eq(messagingChannels.id, input.channelId));
      await appendOutboxEvent(tx, {
        topic: buildChannelTopic(input.channelId),
        kind: 'channel.changed',
        version: 1,
        payload: plan.doorbell,
      });
      counters.changeVersion = plan.message.changeVersion;
    },
  };
}
