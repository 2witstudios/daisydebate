import { tryInstantMs, instantMs, addMs } from '@daisy/clock';
import { and, eq, gt, ne, sql } from 'drizzle-orm';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol/primitives';
import { messagingChannels } from '../schema/messaging-channels';
import { appendStream } from '../messaging/stream';
import { messagingMessages } from '../schema/messaging-messages';
import { messagingFiles } from '../schema/messaging-files';
import { requireFilePolicy } from './policy';
import { requireReservation } from './reservation-input';
import { createFileListing } from './message-files';
import type {
  FileFrame,
  FileReservation,
  FileScope,
  FileToken,
} from './records';
import type { Tx } from '../tx';

type Row = typeof messagingFiles.$inferSelect;
const reservation = (row: Row): FileReservation => {
  if (row.filename === null) throw createAppError('INVARIANT');
  return {
    lifecycle: row.lifecycle as FileReservation['lifecycle'],
    id: row.id,
    channelId: row.channelId,
    ownerActorId: row.ownerActorId,
    objectKey: row.objectKey,
    filename: row.filename,
    mime: row.mime as FileReservation['mime'],
    reservedBytes: row.reservedBytes,
    generation: row.generation,
    authorityRevision: row.authorityRevision,
    expiresAt: row.expiresAt.toISOString(),
  };
};
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
  tx: Tx,
  input: FileScope,
  counters: { channelId: string; changeVersion: number },
  authorize: () => Promise<void>,
): FileFrame {
  const { channelId } = input;
  const changed = async () => {
    ({ changeVersion: counters.changeVersion } = await appendStream(
      tx,
      channelId,
      { messages: 0, changes: 1 },
    ));
  };
  const currentRevision = async () => {
    const [channel] = await tx
      .select({ revision: messagingChannels.authorityRevision })
      .from(messagingChannels)
      .where(eq(messagingChannels.id, channelId));
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
          eq(messagingFiles.channelId, channelId),
        ),
      )
      // An owner's change locks the row; an access read only excludes
      // maintenance writers, so readers of one file never serialize.
      .for(owned ? 'update' : 'share');
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
      tryInstantMs(now) === undefined ||
      row.expiresAt.getTime() <= instantMs(now) ||
      row.authorityRevision !== (await currentRevision())
    )
      throw createAppError('CONFLICT');
  };
  const access: FileFrame['access'] = async (token, now, supplied) => {
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
          eq(messagingMessages.channelId, channelId),
        ),
      );
    if (
      !message ||
      message.removedAt !== null ||
      tryInstantMs(now) === undefined
    )
      throw createAppError('NOT_FOUND');
    if (row.storedBytes === null) throw createAppError('INVARIANT');
    return {
      ...reservation(row),
      messageId: row.messageId,
      storedBytes: row.storedBytes,
      accessExpiresAt: addMs(now, policy.accessMs),
    };
  };
  return {
    authorize,
    async reserve(command, now, supplied) {
      await authorize();
      const policy = requireFilePolicy(supplied);
      requireReservation(command, channelId, now, policy);
      const [existing] = await tx
        .select()
        .from(messagingFiles)
        .where(
          and(
            eq(messagingFiles.channelId, channelId),
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
      if (!quota) throw createAppError('INVARIANT');
      if (
        Number(quota.bytes) + command.bytes > policy.maxStoredBytes ||
        Number(quota.count) >= policy.maxStoredFiles
      )
        throw createAppError('PAYLOAD_TOO_LARGE');
      // Every reservation counts, deleted or not, so removing a file never
      // refills the day.
      const [today] = await tx
        .select({ count: sql<string>`count(*)` })
        .from(messagingFiles)
        .where(
          and(
            eq(messagingFiles.ownerActorId, input.actorId),
            gt(messagingFiles.createdAt, new Date(instantMs(now) - 86_400_000)),
          ),
        );
      if (!today) throw createAppError('INVARIANT');
      if (Number(today.count) >= policy.maxUploadsPerDay)
        throw createAppError('RATE_LIMIT');
      const row: typeof messagingFiles.$inferInsert = {
        id: command.id,
        objectKey: command.objectKey,
        channelId: channelId,
        ownerActorId: input.actorId,
        requestId: command.requestId,
        filename: command.filename,
        mime: command.mime,
        reservedBytes: command.bytes,
        lifecycle: 'reserved',
        generation: 1,
        authorityRevision: await currentRevision(),
        createdAt: new Date(now),
        expiresAt: new Date(instantMs(now) + policy.reservationMs),
      };
      const [inserted] = await tx
        .insert(messagingFiles)
        .values(row)
        .returning();
      if (!inserted) throw createAppError('INVARIANT');
      return reservation(inserted);
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
          expiresAt: new Date(instantMs(now) + policy.reservationMs),
        })
        .where(eq(messagingFiles.id, row.id))
        .returning();
      if (!updated) throw createAppError('INVARIANT');
      return reservation(updated);
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
            eq(messagingMessages.channelId, channelId),
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
            eq(messagingFiles.channelId, channelId),
            eq(messagingFiles.messageId, messageId),
            eq(messagingFiles.lifecycle, 'attached'),
          ),
        );
      if (!count) throw createAppError('INVARIANT');
      if (Number(count.value) >= policy.maxFilesPerMessage)
        throw createAppError('PAYLOAD_TOO_LARGE');
      await tx
        .update(messagingFiles)
        .set({ lifecycle: 'attached', messageId })
        .where(eq(messagingFiles.id, row.id));
      await changed();
    },
    access,
    listMessageFiles: createFileListing(tx, channelId, authorize, access),
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
