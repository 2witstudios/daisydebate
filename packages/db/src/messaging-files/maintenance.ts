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
) {
  const rows = await tx.execute(sql`
    select distinct f.owner_actor_id as "actorId", a.user_id as "userId"
    from messaging_files f join actors a on a.id=f.owner_actor_id
    where f.channel_id=${channelId} and f.lifecycle in ('reserved','quarantined')
      and f.expires_at <= ${new Date(now)} order by f.owner_actor_id
  `);
  return [...rows].map((row) => ({
    actorId: idSchema.parse(row.actorId),
    userId: idSchema.parse(row.userId),
  }));
}

async function expireDueChannel(
  database: BunSQLDatabase,
  channelId: string,
  now: string,
) {
  return database.transaction(async (tx) => {
    const owners = await dueOwners(tx, channelId, now);
    const first = owners[0];
    if (!first) return false;
    return withLockedMessagingAuthority(
      tx,
      { ...first, channelId },
      async (frame) => {
        // A new expired owner appearing during a lock wait must be fenced on the next run.
        const current = await dueOwners(tx, channelId, now);
        if (
          current.some(
            (owner) =>
              !owners.some(
                (prior) =>
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
        await expireChannelFiles(tx, channelId, now);
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

/** Trusted worker only; no user-content projection or admission authority. */
export function createMessagingFileMaintenance(database: BunSQLDatabase) {
  return {
    async run(input: {
      now: string;
      maxItems: number;
      remove: (key: string) => Promise<void>;
    }) {
      validateRun(input.now, input.maxItems);
      const channels = await database.execute(sql`
        select distinct channel_id as id from messaging_files
        where lifecycle in ('reserved','quarantined') and expires_at <= ${new Date(input.now)}
        order by channel_id limit ${input.maxItems}
      `);
      let expiredChannels = 0;
      for (const row of channels) {
        try {
          if (
            await expireDueChannel(database, idSchema.parse(row.id), input.now)
          )
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
      let acknowledged = 0;
      for (const item of work) {
        if (item.kind === 'file')
          await acknowledgeFileDeletion(
            database,
            item.fileId,
            input.now,
            input.remove,
          );
        else
          await acknowledgeErasedFileDeletion(
            database,
            item.objectKey,
            input.remove,
          );
        acknowledged += 1;
      }
      return { expiredChannels, acknowledged };
    },
  };
}
