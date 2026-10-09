import { and, eq, ne, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { buildChannelTopic, idSchema } from '@daisy/protocol';
import { appendOutboxEvent } from '../outbox';
import { messagingChannels } from '../schema/messaging-channels';
import { messagingMessages } from '../schema/messaging-messages';
import { messagingFiles } from '../schema/messaging-files';
import { requireFilePolicy } from './policy';
import { requireReservation } from './reservation-input';
import type {
  FileFrame,
  FileReservation,
  FileScope,
  FileToken,
} from './records';

type FileTransaction = Pick<
  BunSQLDatabase,
  'select' | 'insert' | 'update' | 'execute'
>;
type Row = typeof messagingFiles.$inferSelect;
const reservation = (row: Row): FileReservation => ({
  lifecycle: row.lifecycle as FileReservation['lifecycle'],
  id: row.id,
  channelId: row.channelId,
  ownerActorId: row.ownerActorId,
  objectKey: row.objectKey,
  filename: row.filename!,
  mime: row.mime as FileReservation['mime'],
  reservedBytes: row.reservedBytes,
  generation: row.generation,
  authorityRevision: row.authorityRevision,
  expiresAt: row.expiresAt.toISOString(),
});
export const fileDeletionValues = {
  lifecycle: 'deleting',
  filename: null,
  mime: null,
  requestId: null,
  messageId: null,
  generation: sql`${messagingFiles.generation} + 1`,
};
/** Caller holds canonical account/pair/channel locks. Never opens a transaction. */
export function channelFileFrame(
  tx: FileTransaction,
  input: FileScope,
  counters: { channelId: string; changeVersion: number },
  authorize: () => Promise<void>,
): FileFrame {
  const changed = async () => {
    counters.changeVersion += 1;
    await tx
      .update(messagingChannels)
      .set({ changeVersion: counters.changeVersion })
      .where(eq(messagingChannels.id, input.channelId));
    await appendOutboxEvent(tx, {
      topic: buildChannelTopic(input.channelId),
      kind: 'channel.changed',
      version: 1,
      payload: {
        kind: 'channel.changed',
        channelId: input.channelId,
        changeVersion: counters.changeVersion,
      },
    });
  };
  const currentRevision = async () => {
    const [channel] = await tx
      .select({ revision: messagingChannels.authorityRevision })
      .from(messagingChannels)
      .where(eq(messagingChannels.id, input.channelId));
    if (!channel) throw createAppError('NOT_FOUND');
    return channel.revision;
  };
  const read = async (token: FileToken, owned: boolean) => {
    await authorize();
    if (
      !idSchema.safeParse(token.fileId).success ||
      !Number.isSafeInteger(token.generation) ||
      token.generation < 1
    )
      throw createAppError('VALIDATION');
    const [row] = await tx
      .select()
      .from(messagingFiles)
      .where(
        and(
          eq(messagingFiles.id, token.fileId),
          eq(messagingFiles.channelId, input.channelId),
        ),
      )
      .for('update');
    if (
      !row ||
      (owned && row.ownerActorId !== input.actorId) ||
      ['deleting', 'deleted'].includes(row.lifecycle)
    )
      throw createAppError('NOT_FOUND');
    if (row.generation !== token.generation) throw createAppError('CONFLICT');
    return row;
  };
  const live = async (row: Row, now: string) => {
    if (
      !Number.isFinite(Date.parse(now)) ||
      row.expiresAt.getTime() <= Date.parse(now) ||
      row.authorityRevision !== (await currentRevision())
    )
      throw createAppError('CONFLICT');
  };
  return {
    authorize,
    async reserve(command, now, supplied) {
      await authorize();
      const policy = requireFilePolicy(supplied);
      requireReservation(command, input.channelId, now, policy);
      const [existing] = await tx
        .select()
        .from(messagingFiles)
        .where(
          and(
            eq(messagingFiles.channelId, input.channelId),
            eq(messagingFiles.ownerActorId, input.actorId),
            eq(messagingFiles.requestId, command.requestId),
          ),
        );
      if (existing) {
        if (existing.lifecycle !== 'attached') await live(existing, now);
        if (
          existing.reservedBytes !== command.bytes ||
          existing.filename !== command.filename ||
          existing.mime !== command.mime
        )
          throw createAppError('CONFLICT');
        return reservation(existing);
      }
      const [quota] = await tx
        .select({
          bytes: sql<string>`coalesce(sum(${messagingFiles.reservedBytes}),0)`,
          count: sql<string>`count(*)`,
        })
        .from(messagingFiles)
        .where(
          and(
            eq(messagingFiles.ownerActorId, input.actorId),
            ne(messagingFiles.lifecycle, 'deleted'),
          ),
        );
      if (
        Number(quota!.bytes) + command.bytes > policy.maxStoredBytes ||
        Number(quota!.count) >= policy.maxStoredFiles
      )
        throw createAppError('PAYLOAD_TOO_LARGE');
      const row: typeof messagingFiles.$inferInsert = {
        id: command.id,
        objectKey: command.objectKey,
        channelId: input.channelId,
        ownerActorId: input.actorId,
        requestId: command.requestId,
        filename: command.filename,
        mime: command.mime,
        reservedBytes: command.bytes,
        lifecycle: 'reserved',
        generation: 1,
        authorityRevision: await currentRevision(),
        createdAt: new Date(now),
        expiresAt: new Date(Date.parse(now) + policy.reservationMs),
      };
      const [inserted] = await tx
        .insert(messagingFiles)
        .values(row)
        .returning();
      return reservation(inserted!);
    },
    async upload(token, now) {
      const row = await read(token, true);
      if (row.lifecycle !== 'attached') await live(row, now);
      return reservation(row);
    },
    async scan(token, now) {
      const row = await read(token, true);
      if (row.lifecycle !== 'attached') await live(row, now);
      if (!['quarantined', 'attached'].includes(row.lifecycle))
        throw createAppError('CONFLICT');
      return reservation(row);
    },
    async quarantine(token, bytes, now) {
      const row = await read(token, true);
      await live(row, now);
      if (
        row.lifecycle !== 'reserved' ||
        !Number.isSafeInteger(bytes) ||
        bytes < 1 ||
        bytes > row.reservedBytes
      )
        throw createAppError('CONFLICT');
      await tx
        .update(messagingFiles)
        .set({ lifecycle: 'quarantined', storedBytes: bytes })
        .where(eq(messagingFiles.id, row.id));
    },
    async renew(token, now, supplied) {
      const policy = requireFilePolicy(supplied);
      const row = await read(token, true);
      await live(row, now);
      if (row.lifecycle === 'attached') throw createAppError('CONFLICT');
      const [updated] = await tx
        .update(messagingFiles)
        .set({
          generation: row.generation + 1,
          authorityRevision: await currentRevision(),
          expiresAt: new Date(Date.parse(now) + policy.reservationMs),
        })
        .where(eq(messagingFiles.id, row.id))
        .returning();
      return reservation(updated!);
    },
    async finalize(token, messageId, now, supplied) {
      const policy = requireFilePolicy(supplied);
      const row = await read(token, true);
      if (!idSchema.safeParse(messageId).success)
        throw createAppError('VALIDATION');
      const [message] = await tx
        .select()
        .from(messagingMessages)
        .where(
          and(
            eq(messagingMessages.id, messageId),
            eq(messagingMessages.channelId, input.channelId),
          ),
        );
      if (
        !message ||
        message.removedAt !== null ||
        message.authorActorId !== input.actorId
      )
        throw createAppError('NOT_FOUND');
      if (row.lifecycle === 'attached' && row.messageId === messageId) return;
      await live(row, now);
      if (row.lifecycle !== 'quarantined') throw createAppError('CONFLICT');
      const [count] = await tx
        .select({ value: sql<string>`count(*)` })
        .from(messagingFiles)
        .where(
          and(
            eq(messagingFiles.channelId, input.channelId),
            eq(messagingFiles.messageId, messageId),
            eq(messagingFiles.lifecycle, 'attached'),
          ),
        );
      if (Number(count!.value) >= policy.maxFilesPerMessage)
        throw createAppError('PAYLOAD_TOO_LARGE');
      await tx
        .update(messagingFiles)
        .set({ lifecycle: 'attached', messageId })
        .where(eq(messagingFiles.id, row.id));
      await changed();
    },
    async access(token, now, supplied) {
      const policy = requireFilePolicy(supplied);
      const row = await read(token, false);
      if (row.lifecycle !== 'attached' || !row.messageId)
        throw createAppError('NOT_FOUND');
      const [message] = await tx
        .select({ removedAt: messagingMessages.removedAt })
        .from(messagingMessages)
        .where(
          and(
            eq(messagingMessages.id, row.messageId),
            eq(messagingMessages.channelId, input.channelId),
          ),
        );
      if (
        !message ||
        message.removedAt !== null ||
        !Number.isFinite(Date.parse(now))
      )
        throw createAppError('NOT_FOUND');
      return {
        ...reservation(row),
        messageId: row.messageId,
        storedBytes: row.storedBytes!,
        accessExpiresAt: new Date(
          Date.parse(now) + policy.accessMs,
        ).toISOString(),
      };
    },
    async cancel(token) {
      const row = await read(token, true);
      await tx
        .update(messagingFiles)
        .set(fileDeletionValues)
        .where(eq(messagingFiles.id, row.id));
      if (row.lifecycle === 'attached') await changed();
    },
  };
}
