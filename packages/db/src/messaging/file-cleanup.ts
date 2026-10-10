import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import type { MessagingChannelFact } from './social';
import type { FileReservation } from '../messaging-files';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
import {
  failPendingFile,
  type FileScope,
  type FileToken,
} from '../messaging-files';

type PendingFileFact = {
  readonly kind: 'pending_file';
  readonly fileId: string;
  readonly channelId: string;
  readonly ownerActorId: string;
  readonly lifecycle: FileReservation['lifecycle'] | 'deleting' | 'deleted';
  readonly generation: number;
  readonly expectedGeneration: number;
  readonly revision: number;
  readonly channel: Pick<
    MessagingChannelFact,
    'channelId' | 'policyKey' | 'policyRevision' | 'revision'
  > & { readonly kind: 'dm' | 'private_group' };
};
export type MessagingFileCleanupFence = (
  tx: AuthorizationTransaction,
  input: FileScope,
  frame: {
    readonly fact: PendingFileFact;
    readonly accounts: Awaited<ReturnType<typeof lockAuthorizationActors>>;
  },
) => Promise<void>;

/** Cleanup owns no history/grant read. Account -> pair -> channel -> own file, all in one tx. */
export function createMessagingFileCleanup({
  database,
  authorize,
}: {
  readonly database: BunSQLDatabase;
  readonly authorize: MessagingFileCleanupFence;
}) {
  return async (scope: FileScope, token: FileToken): Promise<void> => {
    for (const id of [
      scope.userId,
      scope.actorId,
      scope.channelId,
      token.fileId,
    ])
      if (!idSchema.safeParse(id).success) throw createAppError('VALIDATION');
    if (!Number.isSafeInteger(token.generation) || token.generation < 1)
      throw createAppError('VALIDATION');
    await database.transaction(async (tx) => {
      const pairs = await tx.execute(
        sql`select low_actor_id, high_actor_id from messaging_dm_pairs where channel_id=${scope.channelId}`,
      );
      const pair = pairs[0];
      const actors = [
        ...new Set([
          scope.actorId,
          ...(pair
            ? [String(pair.low_actor_id), String(pair.high_actor_id)]
            : []),
        ]),
      ].sort();
      const accounts = await lockAuthorizationActors(tx, actors, {
        maxActors: 65535,
      });
      if (pair)
        await tx.execute(
          sql`select low_actor_id from messaging_contact_pairs where low_actor_id=${pair.low_actor_id} and high_actor_id=${pair.high_actor_id} for update`,
        );
      const channels = await tx.execute(
        sql`select id as "channelId", kind, policy_key as "policyKey", policy_revision::float8 as "policyRevision", authority_revision::float8 as revision from messaging_channels where id=${scope.channelId} for update`,
      );
      if (!channels[0]) throw createAppError('NOT_FOUND');
      const files = await tx.execute(
        sql`select id as "fileId",channel_id as "channelId",owner_actor_id as "ownerActorId",lifecycle,generation::float8 as generation,authority_revision::float8 as revision from messaging_files where id=${token.fileId} and channel_id=${scope.channelId} and owner_actor_id=${scope.actorId} for update`,
      );
      if (!files[0]) throw createAppError('NOT_FOUND');
      // Rows are produced by closed schema columns; canonical AZC validates their values.
      const fact = {
        ...files[0],
        kind: 'pending_file',
        expectedGeneration: token.generation,
        channel: channels[0],
      } as PendingFileFact;
      await authorize(tx, scope, { fact, accounts });
      await failPendingFile(tx, scope, token);
    });
  };
}
