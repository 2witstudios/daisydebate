import { and, asc, desc, eq, gt, lt, lte, isNull, sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingMessages } from '../schema/messaging-messages';
import { messagingActorStates } from '../schema/messaging-channels';
import { messageRecord } from './message-record';
import type { MessagingCounters } from './records';

const requirePageLimit = (limit: number) => {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 65535)
    throw createAppError('VALIDATION');
};
const requireOrder = (order: number) => {
  if (!Number.isSafeInteger(order) || order < 0)
    throw createAppError('VALIDATION');
};
/** Transaction is already fenced; the port enforces the protected-read guard. */
export function channelReadFrame(
  tx: Pick<BunSQLDatabase, 'select' | 'insert'>,
  input: { readonly channelId: string; readonly actorId: string },
  counters: MessagingCounters,
  authorize: () => Promise<void>,
) {
  const channel = eq(messagingMessages.channelId, input.channelId);
  return {
    async history({
      limit,
      before,
      query,
    }: {
      readonly limit: number;
      readonly before?: number;
      readonly query?: string;
    }) {
      await authorize();
      requirePageLimit(limit);
      if (before !== undefined) requireOrder(before);
      if (
        query !== undefined &&
        (typeof query !== 'string' || query.trim().length === 0)
      )
        throw createAppError('VALIDATION');
      const rows = await tx
        .select()
        .from(messagingMessages)
        .where(
          and(
            channel,
            query === undefined
              ? undefined
              : and(
                  isNull(messagingMessages.removedAt),
                  sql`strpos(lower(${messagingMessages.text}), lower(${query})) > 0`,
                ),
            before === undefined
              ? undefined
              : lt(messagingMessages.sequence, before),
          ),
        )
        .orderBy(desc(messagingMessages.sequence))
        .limit(limit + 1);
      const page = rows.slice(0, limit).map(messageRecord);
      return {
        messages: page,
        changeVersion: counters.changeVersion,
        nextBefore:
          rows.length > limit
            ? { channelId: input.channelId, sequence: page.at(-1)!.sequence }
            : null,
      };
    },
    async changes({
      limit,
      after,
    }: {
      readonly limit: number;
      readonly after: number;
    }) {
      await authorize();
      requirePageLimit(limit);
      requireOrder(after);
      if (after > counters.changeVersion) throw createAppError('VALIDATION');
      const rows = await tx
        .select()
        .from(messagingMessages)
        .where(
          and(
            channel,
            gt(messagingMessages.changeVersion, after),
            lte(messagingMessages.changeVersion, counters.changeVersion),
          ),
        )
        .orderBy(asc(messagingMessages.changeVersion))
        .limit(limit + 1);
      const page = rows.slice(0, limit).map(messageRecord);
      return {
        messages: page,
        changeVersion: counters.changeVersion,
        nextAfter: {
          channelId: input.channelId,
          changeVersion:
            rows.length > limit
              ? page.at(-1)!.changeVersion
              : counters.changeVersion,
        },
      };
    },
    async markRead(sequence: number) {
      await authorize();
      requireOrder(sequence);
      if (sequence > counters.messageSequence)
        throw createAppError('VALIDATION');
      const [row] = await tx
        .insert(messagingActorStates)
        .values({
          channelId: input.channelId,
          actorId: input.actorId,
          following: false,
          hidden: false,
          notificationLevel: 'none',
          readSequence: sequence,
        })
        .onConflictDoUpdate({
          target: [
            messagingActorStates.channelId,
            messagingActorStates.actorId,
          ],
          set: {
            readSequence: sql`greatest(${messagingActorStates.readSequence},${sequence})`,
          },
        })
        .returning({ readSequence: messagingActorStates.readSequence });
      if (!row) throw createAppError('INFRASTRUCTURE');
      return row.readSequence;
    },
  };
}
