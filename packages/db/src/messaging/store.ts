import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic, idSchema } from '@daisy/protocol';
import { lockAuthorizationActors } from '../authorization';
import { appendOutboxEvent } from '../outbox';
import { messagingChannels } from '../schema/messaging-channels';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import { messagingContactPairs } from '../schema/messaging-social';
import { readMessagingChannelFact, type MessagingChannelFact } from './social';
import type {
  MessagingChannelStore,
  MessagingMessageRecord,
  MessagingSendCommand,
} from './records';

const actorIdsOf = (fact: MessagingChannelFact, actorId: string) =>
  [
    ...new Set([
      actorId,
      ...(fact.authority.kind === 'dm'
        ? [fact.authority.lowActorId, fact.authority.highActorId]
        : fact.authority.activeMemberActorIds),
    ]),
  ].sort();
const recordOf = (
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

/** Scope-specific transaction frame; never exposes a raw database to delivery. */
export function createMessagingStore({
  database,
}: {
  readonly database: BunSQLDatabase;
}): MessagingChannelStore {
  return {
    withChannel: async (input, work) => {
      for (const id of [input.channelId, input.actorId, input.userId])
        if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        // Discover only authority identities; no message/receipt content is read.
        const discovered = await readMessagingChannelFact(
          tx,
          input.channelId,
          input.actorId,
        );
        if (!discovered) throw createAppError('NOT_FOUND');
        const actors = actorIdsOf(discovered, input.actorId);
        const accounts = await lockAuthorizationActors(tx, actors, {
          maxActors: 65535,
        });
        if (discovered.authority.kind === 'dm')
          await tx.execute(sql`
          select low_actor_id from ${messagingContactPairs}
          where low_actor_id = ${discovered.authority.lowActorId} and high_actor_id = ${discovered.authority.highActorId}
          for update
        `);
        const [channel] = await tx
          .select()
          .from(messagingChannels)
          .where(eq(messagingChannels.id, input.channelId))
          .for('update');
        if (!channel) throw createAppError('NOT_FOUND');
        const fact = await readMessagingChannelFact(
          tx,
          input.channelId,
          input.actorId,
        );
        if (!fact) throw createAppError('NOT_FOUND');
        if (
          JSON.stringify(actors) !==
          JSON.stringify(actorIdsOf(fact, input.actorId))
        )
          throw createAppError('CONFLICT');
        const counters = {
          channelId: channel.id,
          messageSequence: channel.messageSequence,
          changeVersion: channel.changeVersion,
        };
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
          return row ? recordOf(row) : null;
        };
        return work({
          fact,
          accounts,
          counters,
          async readSendState(send) {
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
      });
    },
  };
}
