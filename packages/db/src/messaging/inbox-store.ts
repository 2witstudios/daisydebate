import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { idSchema } from '@daisy/protocol';
import {
  lockAuthorizationActors,
  type AuthorizationTransaction,
} from '../authorization';
type InboxScope = {
  readonly userId: string;
  readonly actorId: string;
  readonly limit: number;
  readonly after?: string;
};
type CollectionFence = (input: {
  readonly tx: AuthorizationTransaction;
  readonly scope: InboxScope;
  readonly account: Awaited<ReturnType<typeof lockAuthorizationActors>>[number];
}) => Promise<void>;
/** Candidate IDs are private own associations, never channel grants or content. */
export function createMessagingInboxStore(
  database: BunSQLDatabase,
  authorize: CollectionFence,
) {
  return {
    candidates: async (scope: InboxScope): Promise<readonly string[]> => {
      if (
        !idSchema.safeParse(scope.userId).success ||
        !idSchema.safeParse(scope.actorId).success ||
        !Number.isSafeInteger(scope.limit) ||
        scope.limit < 1 ||
        scope.limit > 65535 ||
        (scope.after !== undefined && !idSchema.safeParse(scope.after).success)
      )
        throw createAppError('VALIDATION');
      return database.transaction(async (tx) => {
        const [account] = await lockAuthorizationActors(tx, [scope.actorId], {
          maxActors: 1,
        });
        await authorize({ tx, scope, account: account ?? null });
        const rows = await tx.execute(sql`
        select distinct candidate.channel_id as "channelId" from (
          select channel_id from public.messaging_dm_pairs
          where low_actor_id = ${scope.actorId} or high_actor_id = ${scope.actorId}
          union all
          select channel_id from public.messaging_group_grants
          where actor_id = ${scope.actorId} and revoked_at is null
        ) candidate
        where (${scope.after ?? null}::text is null or candidate.channel_id > ${scope.after ?? null}::text)
        order by candidate.channel_id limit ${scope.limit}
      `);
        return rows.map((row) => {
          const channel = idSchema.safeParse(row.channelId);
          if (!channel.success) throw createAppError('INFRASTRUCTURE');
          return channel.data;
        });
      });
    },
  };
}
