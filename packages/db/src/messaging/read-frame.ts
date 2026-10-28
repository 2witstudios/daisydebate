import type { AuthorizationTransaction } from '../authorization';
import { invalidateMessagingInboxes } from './inbox-change';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  lt,
  lte,
  isNull,
  sql,
  type SQL,
} from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { createAppError } from '@daisy/errors';
import { messagingMessages } from '../schema/messaging-messages';
import {
  messagingActorStates,
  messagingChannelStreams,
} from '../schema/messaging-channels';
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
type PageRow = {
  readonly message: typeof messagingMessages.$inferSelect | null;
  readonly changeVersion: number;
};
/** Pure: a history page from one statement's rows (descending sequence). */
export function historyPage(
  rows: readonly PageRow[],
  limit: number,
  channelId: string,
) {
  const found = rows.flatMap((row) => (row.message ? [row.message] : []));
  const page = found.slice(0, limit).map(messageRecord);
  return {
    messages: page,
    changeVersion: rows[0]!.changeVersion,
    nextBefore:
      found.length > limit
        ? { channelId, sequence: page.at(-1)!.sequence }
        : null,
  };
}
/** Pure: a changes page from one statement's rows (ascending change version). */
export function changesPage(
  rows: readonly PageRow[],
  limit: number,
  after: number,
  channelId: string,
) {
  const changeVersion = rows[0]!.changeVersion;
  if (after > changeVersion) throw createAppError('VALIDATION');
  const found = rows.flatMap((row) => (row.message ? [row.message] : []));
  const page = found.slice(0, limit).map(messageRecord);
  return {
    messages: page,
    changeVersion,
    nextAfter: {
      channelId,
      changeVersion:
        found.length > limit ? page.at(-1)!.changeVersion : changeVersion,
    },
  };
}

/**
 * Transaction is already fenced; the port enforces the protected-read guard.
 * A page reads its stream high-water mark and its rows in one statement, so
 * both come from one MVCC snapshot while writers share the fences (§3B).
 */
export function channelReadFrame(
  tx: Pick<BunSQLDatabase, 'select' | 'insert'> & AuthorizationTransaction,
  input: { readonly channelId: string; readonly actorId: string },
  counters: MessagingCounters,
  authorize: () => Promise<void>,
) {
  const page = (filter: SQL | undefined) =>
    tx
      .select({
        message: messagingMessages,
        changeVersion: messagingChannelStreams.changeVersion,
      })
      .from(messagingChannelStreams)
      .leftJoin(
        messagingMessages,
        and(
          eq(messagingMessages.channelId, messagingChannelStreams.channelId),
          filter,
        ),
      )
      .where(eq(messagingChannelStreams.channelId, input.channelId));
  const required = <T extends readonly unknown[]>(rows: T) => {
    if (rows.length === 0) throw createAppError('NOT_FOUND');
    return rows;
  };
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
      const rows = await page(
        and(
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
      return historyPage(required(rows), limit, input.channelId);
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
      const rows = await page(
        and(
          gt(messagingMessages.changeVersion, after),
          lte(
            messagingMessages.changeVersion,
            messagingChannelStreams.changeVersion,
          ),
        ),
      )
        .orderBy(asc(messagingMessages.changeVersion))
        .limit(limit + 1);
      return changesPage(required(rows), limit, after, input.channelId);
    },
    async markRead(sequence: number) {
      await authorize();
      requireOrder(sequence);
      if (sequence > counters.messageSequence)
        throw createAppError('VALIDATION');
      // The upsert answers a row only when it inserted or advanced the
      // position; otherwise the current one is read back.
      const [advanced] = await tx
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
          set: { readSequence: sequence },
          setWhere: lt(messagingActorStates.readSequence, sequence),
        })
        .returning({ readSequence: messagingActorStates.readSequence });
      if (advanced) {
        // ISSUE-603: the reader's other open inboxes refresh their unread state.
        await invalidateMessagingInboxes(tx, [input.actorId]);
        return advanced.readSequence;
      }
      const [current] = await tx
        .select({ readSequence: messagingActorStates.readSequence })
        .from(messagingActorStates)
        .where(
          and(
            eq(messagingActorStates.channelId, input.channelId),
            eq(messagingActorStates.actorId, input.actorId),
          ),
        );
      if (!current) throw createAppError('INFRASTRUCTURE');
      return current.readSequence;
    },
  };
}
