import { and, eq, inArray, or } from 'drizzle-orm';
import type { MessagingOperationTransaction } from './authority-frame';
import {
  messagingMessages,
  messagingReceipts,
} from '../schema/messaging-messages';
import { messageRecord } from './message-record';
import type { MessagingStreamCounters } from './stream';
import { isMutation, type ContentAttempt } from './append-contracts';
import { appendReceiptKey, type AppendScratch } from './append-decisions';

/** Bulk receipt/reference reads after current authorization and the one stream lock. */
export async function readAppendScratch(
  tx: MessagingOperationTransaction,
  channelId: string,
  attempts: readonly ContentAttempt[],
  locked: MessagingStreamCounters,
): Promise<AppendScratch> {
  const receipts = attempts.length
    ? await tx
        .select()
        .from(messagingReceipts)
        .where(
          and(
            eq(messagingReceipts.channelId, channelId),
            or(
              ...attempts.map(({ scope, command }) =>
                and(
                  eq(messagingReceipts.actorId, scope.actorId),
                  eq(messagingReceipts.requestId, command.requestId),
                ),
              ),
            ),
          ),
        )
    : [];
  const ids = [
    ...new Set(
      [
        ...receipts.map((row) => row.messageId),
        ...attempts.map((attempt) =>
          isMutation(attempt)
            ? attempt.command.messageId
            : attempt.command.replyToMessageId,
        ),
      ].filter((id): id is string => typeof id === 'string'),
    ),
  ];
  const rows = ids.length
    ? await tx
        .select()
        .from(messagingMessages)
        .where(
          and(
            eq(messagingMessages.channelId, channelId),
            inArray(messagingMessages.id, ids),
          ),
        )
    : [];
  return {
    channelId,
    locked,
    counters: { channelId, ...locked },
    byReceipt: new Map(
      receipts.map((row) => [
        appendReceiptKey(row.actorId, row.requestId),
        row,
      ]),
    ),
    messages: new Map(rows.map((row) => [row.id, messageRecord(row)])),
    creates: [],
    changed: new Map(),
    removed: new Set(),
    bells: [],
    replayed: new Set(),
    insertedReceipts: [],
  };
}
