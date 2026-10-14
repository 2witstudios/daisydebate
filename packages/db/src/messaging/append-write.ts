import { and, eq, inArray, sql } from 'drizzle-orm';
import { buildChannelTopic } from '@daisy/protocol';
import type { MessagingOperationTransaction } from './authority-frame';
import { advanceMessagingStream } from './stream';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import { messagingFiles } from '../schema/messaging-files';
import { fileDeletionValues } from '../messaging-files/frame';
import { outbox } from '../schema/outbox';
import type { AppendScratch } from './append-decisions';
export async function writeAppend(
  tx: MessagingOperationTransaction,
  scratch: AppendScratch,
) {
  const {
    channelId,
    creates,
    changed,
    removed,
    bells,
    insertedReceipts,
    messages,
  } = scratch;
  if (bells.length) {
    await advanceMessagingStream(tx, channelId, scratch.locked, {
      messages: creates.length,
      changes: bells.length,
    });
    if (creates.length)
      await tx.insert(messagingMessages).values(
        creates.map(({ message }) => {
          const current = messages.get(message.id)!;
          return {
            ...current,
            createdAt: new Date(current.createdAt),
            editedAt: current.editedAt ? new Date(current.editedAt) : null,
            removedAt: current.removedAt ? new Date(current.removedAt) : null,
          };
        }),
      );
    const existingChanges = [...changed.values()].filter(
      (message) => !creates.some((plan) => plan.message.id === message.id),
    );
    if (existingChanges.length)
      await tx.execute(sql`
              update messaging_messages m set text=v.text, change_version=v."changeVersion", edited_at=v."editedAt", removed_at=v."removedAt"
              from jsonb_to_recordset(${JSON.stringify(existingChanges)}::text::jsonb) as v(id text,text text,"changeVersion" bigint,"editedAt" timestamptz,"removedAt" timestamptz)
              where m.channel_id=${channelId} and m.id=v.id
            `);
    if (removed.size) {
      await tx
        .update(messagingFiles)
        .set(fileDeletionValues)
        .where(
          and(
            eq(messagingFiles.channelId, channelId),
            inArray(messagingFiles.messageId, [...removed]),
            eq(messagingFiles.lifecycle, 'attached'),
          ),
        );
      await tx
        .update(messagingReceipts)
        .set({ payloadDigest: null })
        .where(
          and(
            eq(messagingReceipts.channelId, channelId),
            inArray(messagingReceipts.messageId, [...removed]),
          ),
        );
    }
    await tx.insert(messagingReceipts).values(
      insertedReceipts.map((row) => ({
        ...row,
        payloadDigest:
          row.messageId && removed.has(row.messageId)
            ? null
            : row.payloadDigest,
      })),
    );
    await tx.insert(outbox).values(
      bells.map((doorbell) => ({
        topic: buildChannelTopic(channelId),
        kind: 'channel.changed',
        version: 1,
        payload: doorbell,
      })),
    );
  }
}
