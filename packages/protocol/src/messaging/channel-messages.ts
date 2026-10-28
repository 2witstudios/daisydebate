import {
  observationFrameBytes,
  observationJsonBytes,
  observationWindowItems,
} from '../observation';
import { createMessagingCoreSchemas, type MessagingCoreBounds } from './core';

/** One stored message as every reader sees it, before disclosure mapping. */
export type ChannelMessageRecord = {
  readonly id: string;
  readonly channelId: string;
  readonly authorActorId: string;
  readonly sequence: number;
  readonly changeVersion: number;
  readonly text: string | null;
  readonly createdAt: string;
  readonly editedAt: string | null;
  readonly removedAt: string | null;
  readonly replyToMessageId?: string;
};

/** A removed or erased message keeps its position and discloses nothing else. */
export function channelMessageView(message: ChannelMessageRecord) {
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

/**
 * Room left in a 128KiB observation frame for the window's messages once the
 * worst-case envelope (ids, revisions, partition) is paid for.
 */
export const channelMessagesWindowBytes = observationFrameBytes - 2 * 1024;

/**
 * The owning channel mapper, shared by authorized HTTP history and the
 * observation projector (ADR 0089): newest first, at most `limit` messages
 * and at most `byteBudget` bytes of them. A message that does not fit is
 * never truncated: the page ends before it and `nextBefore` continues after
 * the last complete message included. `records` holds up to `limit + 1`
 * rows, the extra one proving older history exists.
 */
export function createChannelMessagesProjector(bounds: MessagingCoreBounds) {
  const { historyResult } = createMessagingCoreSchemas(bounds);
  return function project(input: {
    readonly channelId: string;
    readonly changeVersion: number;
    readonly records: readonly ChannelMessageRecord[];
    readonly limit: number;
    readonly byteBudget?: number;
  }) {
    const budget = input.byteBudget ?? Number.POSITIVE_INFINITY;
    const messages: ReturnType<typeof channelMessageView>[] = [];
    let bytes = 2;
    for (const record of input.records.slice(0, input.limit)) {
      const view = channelMessageView(record);
      const size = observationJsonBytes(view) + 1;
      if (bytes + size > budget) break;
      bytes += size;
      messages.push(view);
    }
    const older = input.records.length > messages.length;
    return historyResult.parse({
      version: 1,
      channelId: input.channelId,
      changeVersion: input.changeVersion,
      messages,
      nextBefore:
        older && messages.length > 0
          ? { channelId: input.channelId, sequence: messages.at(-1)!.sequence }
          : null,
    });
  };
}

/** The live window an observation snapshot carries: the latest page. */
export const channelMessagesWindow = {
  limit: observationWindowItems,
  byteBudget: channelMessagesWindowBytes,
} as const;
