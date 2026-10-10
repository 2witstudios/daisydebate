import { and, eq, inArray, isNull } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messagingFiles } from '../schema/messaging-files';
import { messagingMessages } from '../schema/messaging-messages';
import { requireFilePolicy } from './policy';
import type { FileFrame } from './records';

/** Caller supplies canonical visible history IDs inside the existing read transaction. */
export function createFileListing(
  tx: Pick<BunSQLDatabase, 'select'>,
  channelId: string,
  authorize: () => Promise<void>,
  access: FileFrame['access'],
): FileFrame['listMessageFiles'] {
  return async (messageIds, now, supplied) => {
    await authorize();
    const policy = requireFilePolicy(supplied);
    if (!Array.isArray(messageIds) || !Number.isFinite(Date.parse(now)))
      throw createAppError('VALIDATION');
    const ids = [...new Set(messageIds)];
    if (ids.some((id) => !idSchema.safeParse(id).success))
      throw createAppError('VALIDATION');
    if (ids.length === 0) return [];
    const candidates = await tx
      .select({
        fileId: messagingFiles.id,
        generation: messagingFiles.generation,
        messageId: messagingFiles.messageId,
      })
      .from(messagingFiles)
      .innerJoin(
        messagingMessages,
        and(
          eq(messagingFiles.messageId, messagingMessages.id),
          eq(messagingFiles.channelId, messagingMessages.channelId),
        ),
      )
      .where(
        and(
          eq(messagingFiles.channelId, channelId),
          eq(messagingFiles.lifecycle, 'attached'),
          inArray(messagingFiles.messageId, ids),
          isNull(messagingMessages.removedAt),
        ),
      )
      .orderBy(messagingFiles.messageId, messagingFiles.id);
    const result = [];
    for (const candidate of candidates) {
      const current = await access(candidate, now, policy);
      if (current.messageId !== candidate.messageId)
        throw createAppError('CONFLICT');
      result.push({
        fileId: current.id,
        generation: current.generation,
        messageId: current.messageId,
        filename: current.filename,
        mime: current.mime,
        bytes: current.storedBytes,
      });
    }
    return result;
  };
}
