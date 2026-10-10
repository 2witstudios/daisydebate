import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError, isAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { AuthorizationTransaction } from '../authorization';
import { withLockedMessagingAuthority } from '../messaging/authority-frame';
import {
  acknowledgeErasedFileDeletion,
  acknowledgeFileDeletion,
  expireChannelFiles,
  pendingFileDeletions,
} from './cleanup';

async function dueOwners(
  tx: AuthorizationTransaction,
  channelId: string,
  now: string,
  fileIds: readonly string[],
) {
  const rows = await tx.execute(sql`
    select f.id as "fileId", f.owner_actor_id as "actorId", a.user_id as "userId"
    from messaging_files f join actors a on a.id=f.owner_actor_id
    where f.channel_id=${channelId} and f.id = any(${fileIds}::text[]) and f.lifecycle in ('reserved','quarantined')
      and f.expires_at <= ${new Date(now)} order by f.owner_actor_id
  `);
  return [...rows].map((row) => ({
    fileId: idSchema.parse(row.fileId),
    actorId: idSchema.parse(row.actorId),
    userId: idSchema.parse(row.userId),
  }));
}

async function expireDueChannel(
  database: BunSQLDatabase,
  channelId: string,
  now: string,
  fileIds: readonly string[],
) {
  return database.transaction(async (tx) => {
    const owners = await dueOwners(tx, channelId, now, fileIds);
    const first = owners[0];
    if (!first) return false;
    return withLockedMessagingAuthority(
      tx,
      { ...first, channelId },
      async (frame) => {
        // A new expired owner appearing during a lock wait must be fenced on the next run.
        const current = await dueOwners(tx, channelId, now, fileIds);
        if (
          current.some(
            (owner) =>
              !owners.some(
                (prior) =>
                  prior.fileId === owner.fileId &&
                  prior.actorId === owner.actorId &&
                  prior.userId === owner.userId,
              ),
          )
        )
          throw createAppError('CONFLICT');
        if (
          current.some(
            (owner) =>
              !frame.accounts.some(
                (account) =>
                  account?.actorId === owner.actorId &&
                  account.userId === owner.userId &&
                  !account.erased,
              ),
          )
        )
          throw createAppError('CONFLICT');
        if (current.length === 0) return false;
        await expireChannelFiles(
          tx,
          channelId,
          now,
          current.map((row) => row.fileId),
        );
        return current.length > 0;
      },
      {
        additionalActors: owners.map((owner) => owner.actorId),
        beforeChannel: async () => {},
      },
    );
  });
}

function validateRun(now: string, maxItems: number) {
  if (
    !Number.isFinite(Date.parse(now)) ||
    !Number.isSafeInteger(maxItems) ||
    maxItems < 1 ||
    maxItems > 65535
  )
    throw createAppError('VALIDATION');
}

function groupSelectedFiles(rows: readonly Record<string, unknown>[]) {
  const channels = new Map<string, string[]>();
  for (const row of rows) {
    const channelId = idSchema.parse(row.channelId),
      fileId = idSchema.parse(row.fileId);
    const files = channels.get(channelId) ?? [];
    files.push(fileId);
    channels.set(channelId, files);
  }
  return channels;
}
async function acknowledgeBatch(
  database: BunSQLDatabase,
  now: string,
  remove: (key: string) => Promise<void>,
  work: Awaited<ReturnType<typeof pendingFileDeletions>>,
) {
  let acknowledged = 0,
    failed = false;
  for (const item of work) {
    try {
      if (item.kind === 'file')
        await acknowledgeFileDeletion(database, item.fileId, now, remove);
      else
        await acknowledgeErasedFileDeletion(database, item.objectKey, remove);
      acknowledged++;
    } catch {
      failed = true;
    }
  }
  if (failed) throw createAppError('INFRASTRUCTURE');
  return acknowledged;
}

/** Trusted worker only; no user-content projection or admission authority. */
export function createMessagingFileMaintenance(database: BunSQLDatabase) {
  return {
    async run(input: {
      now: string;
      maxItems: number;
      remove: (key: string) => Promise<void>;
    }) {
      validateRun(input.now, input.maxItems);
      const selected = await database.execute(sql`
        select id as "fileId", channel_id as "channelId" from messaging_files
        where lifecycle in ('reserved','quarantined') and expires_at <= ${new Date(input.now)}
        order by expires_at, id limit ${input.maxItems}
      `);
      const channels = groupSelectedFiles(selected);
      let expiredChannels = 0;
      for (const [channelId, fileIds] of channels) {
        try {
          if (await expireDueChannel(database, channelId, input.now, fileIds))
            expiredChannels += 1;
        } catch (error) {
          // Erasure/cast change can remove authority; do not recreate it or hide service failures.
          if (
            !isAppError(error) ||
            !['NOT_FOUND', 'CONFLICT'].includes(error.code)
          )
            throw error;
        }
      }
      const work = await pendingFileDeletions(database, input.maxItems);
      const acknowledged = await acknowledgeBatch(
        database,
        input.now,
        input.remove,
        work,
      );
      return { expiredChannels, acknowledged };
    },
  };
}
