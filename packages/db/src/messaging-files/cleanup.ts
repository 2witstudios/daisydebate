import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import { messagingFiles } from '../schema/messaging-files';
import { fileDeletionValues } from './frame';
import type { AuthorizationTransaction } from '../authorization';

/** Parent calls in its message-removal transaction after channel/user fences. */
export async function deleteMessageFiles(
  tx: Pick<BunSQLDatabase, 'update'>,
  input: { channelId: string; messageId: string },
) {
  await tx
    .update(messagingFiles)
    .set(fileDeletionValues)
    .where(
      and(
        eq(messagingFiles.channelId, input.channelId),
        eq(messagingFiles.messageId, input.messageId),
        eq(messagingFiles.lifecycle, 'attached'),
      ),
    );
}
/** Only this subject's authored objects, never another member's shared files. */
export async function eraseSubjectFiles(
  tx: AuthorizationTransaction,
  actorId: string,
) {
  if (!idSchema.safeParse(actorId).success) throw createAppError('VALIDATION');
  await tx.execute(sql`
    select c.id from messaging_channels c
    where c.id in (select channel_id from messaging_files where owner_actor_id = ${actorId} and lifecycle <> 'deleted')
    order by c.id for update
  `);
  await tx.execute(sql`
    update messaging_files set lifecycle = 'deleting', filename = null, mime = null,
      request_id = null, message_id = null, generation = generation + 1
    where owner_actor_id = ${actorId} and lifecycle not in ('deleting','deleted')
  `);
}
export async function exportSubjectFiles(
  tx: AuthorizationTransaction,
  actorId: string,
) {
  if (!idSchema.safeParse(actorId).success) throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    select id, channel_id, request_id, message_id, filename, mime,
      reserved_bytes, stored_bytes, created_at, expires_at
    from messaging_files where owner_actor_id = ${actorId}
      and lifecycle not in ('deleting','deleted') order by id
  `);
  return {
    messaging_files: [...rows] as readonly Readonly<Record<string, unknown>>[],
  };
}
/** Use inside the parent maintenance frame after canonical account/channel locks. */
export async function expireChannelFiles(
  tx: AuthorizationTransaction,
  channelId: string,
  now: string,
) {
  if (
    !idSchema.safeParse(channelId).success ||
    !Number.isFinite(Date.parse(now))
  )
    throw createAppError('VALIDATION');
  await tx.execute(sql`
    update messaging_files set lifecycle = 'deleting', filename = null, mime = null,
      request_id = null, message_id = null, generation = generation + 1
    where channel_id = ${channelId} and lifecycle in ('reserved','quarantined') and expires_at <= ${new Date(now)}
  `);
}
/** The private vendor port must resolve only after actual delete acknowledgement. */
export async function acknowledgeFileDeletion(
  database: BunSQLDatabase,
  fileId: string,
  now: string,
  remove: (key: string) => Promise<void>,
) {
  if (!idSchema.safeParse(fileId).success || !Number.isFinite(Date.parse(now)))
    throw createAppError('VALIDATION');
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(messagingFiles)
      .where(eq(messagingFiles.id, fileId))
      .for('update');
    if (!row || row.lifecycle === 'deleted') return;
    if (row.lifecycle !== 'deleting') throw createAppError('CONFLICT');
    // A failed/ambiguous response rolls back; reservations stay charged.
    await remove(row.objectKey);
    await tx
      .update(messagingFiles)
      .set({ lifecycle: 'deleted', deletedAt: new Date(now) })
      .where(eq(messagingFiles.id, fileId));
  });
}
/** Trusted failure cleanup; caller holds account/channel locks, never touches attached survivor content. */
export async function failPendingFile(
  tx: AuthorizationTransaction,
  scope: { actorId: string; channelId: string },
  token: { fileId: string; generation: number },
) {
  await tx.execute(sql`
    update messaging_files set lifecycle = 'deleting', filename = null, mime = null,
      request_id = null, message_id = null, generation = generation + 1
    where id = ${token.fileId} and channel_id = ${scope.channelId} and owner_actor_id = ${scope.actorId}
      and generation = ${token.generation} and lifecycle in ('reserved','quarantined')
  `);
}
