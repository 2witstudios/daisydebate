import { and, eq, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  messagingFiles,
  messagingFileDeletionIntents,
} from '../schema/messaging-files';
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
  // Canonical adopter acquires its complete sorted pair/channel set before invoking this hook.
  await tx.execute(sql`
    insert into messaging_file_deletion_intents(object_key, charged_bytes)
    select object_key, reserved_bytes from messaging_files
    where owner_actor_id = ${actorId} and lifecycle <> 'deleted'
  `);
  await tx.execute(
    sql`delete from messaging_files where owner_actor_id = ${actorId}`,
  );
}
export async function exportSubjectFiles(
  tx: AuthorizationTransaction,
  actorId: string,
) {
  if (!idSchema.safeParse(actorId).success) throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    select id, channel_id, owner_actor_id, request_id, message_id, filename, mime,
      reserved_bytes, stored_bytes, generation, authority_revision, lifecycle,
      created_at, expires_at, deleted_at
    from messaging_files where owner_actor_id = ${actorId} order by id
  `);
  return {
    messaging_files: [...rows].map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key,
          value instanceof Date
            ? value.toISOString()
            : typeof value === 'bigint'
              ? Number(value)
              : value,
        ]),
      ),
    ),
  };
}
/** Use inside the parent maintenance frame after canonical account/channel locks. */
export async function expireChannelFiles(
  tx: AuthorizationTransaction,
  channelId: string,
  now: string,
  fileIds?: readonly string[],
) {
  if (
    !idSchema.safeParse(channelId).success ||
    !Number.isFinite(Date.parse(now)) ||
    (fileIds !== undefined &&
      (!Array.isArray(fileIds) ||
        fileIds.length === 0 ||
        new Set(fileIds).size !== fileIds.length ||
        [...fileIds].some((id) => !idSchema.safeParse(id).success)))
  )
    throw createAppError('VALIDATION');
  const selected =
    fileIds === undefined
      ? sql``
      : sql`and id in (${sql.join(
          fileIds.map((id) => sql`${id}`),
          sql`, `,
        )})`;
  await tx.execute(sql`
    update messaging_files set lifecycle = 'deleting', filename = null, mime = null,
      request_id = null, message_id = null, generation = generation + 1
    where channel_id = ${channelId} and lifecycle in ('reserved','quarantined') and expires_at <= ${new Date(now)}
    ${selected}
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

/** Global charged bytes include unlinked erasure intents until acknowledged. */
export async function chargedFileBytes(
  tx: AuthorizationTransaction,
): Promise<string> {
  const rows = await tx.execute(sql`
    select (coalesce((select sum(reserved_bytes) from messaging_files where lifecycle <> 'deleted'),0)
      + coalesce((select sum(charged_bytes) from messaging_file_deletion_intents),0))::text as bytes
  `);
  return String(rows[0]!.bytes);
}
/** Internal worker port; erased intents contain no subject or channel lookup. */
export async function acknowledgeErasedFileDeletion(
  database: BunSQLDatabase,
  objectKey: string,
  remove: (key: string) => Promise<void>,
) {
  if (!idSchema.safeParse(objectKey).success)
    throw createAppError('VALIDATION');
  return database.transaction(async (tx) => {
    const [intent] = await tx
      .select()
      .from(messagingFileDeletionIntents)
      .where(eq(messagingFileDeletionIntents.objectKey, objectKey))
      .for('update');
    if (!intent) return;
    await remove(intent.objectKey);
    await tx
      .delete(messagingFileDeletionIntents)
      .where(eq(messagingFileDeletionIntents.objectKey, objectKey));
  });
}
type FileDeletionWork =
  | { readonly kind: 'file'; readonly fileId: string }
  | { readonly kind: 'erased'; readonly objectKey: string };
/** Internal bounded worker discovery; never an HTTP/user projection. */
export async function pendingFileDeletions(
  tx: AuthorizationTransaction,
  maxItems: number,
): Promise<readonly FileDeletionWork[]> {
  if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 65535)
    throw createAppError('VALIDATION');
  const rows = await tx.execute(sql`
    select kind, key from (
      select 'file' as kind, id as key from messaging_files where lifecycle='deleting'
      union all
      select 'erased' as kind, object_key as key from messaging_file_deletion_intents
    ) work order by key limit ${maxItems}
  `);
  return [...rows].map((row) =>
    row.kind === 'file'
      ? { kind: 'file' as const, fileId: String(row.key) }
      : { kind: 'erased' as const, objectKey: String(row.key) },
  );
}
