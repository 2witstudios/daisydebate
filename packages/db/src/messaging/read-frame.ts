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
import { z } from 'zod';
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
type ReactionRow = {
  readonly reaction: string;
  readonly count: number;
  readonly own: boolean;
};
type HistoryRow = PageRow & { readonly reactions?: readonly ReactionRow[] };

const reactionRowSchema = z.array(
  z.object({
    reaction: z.string(),
    count: z.number().int().positive(),
    own: z.boolean(),
  }),
);
/**
 * Pure: a history page from one statement's rows (descending sequence).
 * Counts are shared; which reactions are the reader's own stays apart, and a
 * removed message keeps neither.
 */
export function historyPage(
  rows: readonly HistoryRow[],
  limit: number,
  channelId: string,
) {
  const found = rows.flatMap((row) =>
    row.message
      ? [{ message: row.message, reactions: row.reactions ?? [] }]
      : [],
  );
  const kept = found.slice(0, limit);
  const live = (message: typeof messagingMessages.$inferSelect) =>
    message.text !== null && message.removedAt === null;
  const page = kept.map(({ message, reactions }) => ({
    ...messageRecord(message),
    reactions: live(message)
      ? reactions.map(({ reaction, count }) => ({ reaction, count }))
      : [],
  }));
  return {
    messages: page,
    ownReactions: kept.flatMap(({ message, reactions }) => {
      const own = reactions.filter((item) => item.own);
      return live(message) && own.length > 0
        ? [
            {
              messageId: message.id,
              reactions: own.map((item) => item.reaction),
            },
          ]
        : [];
    }),
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
  /** One MVCC snapshot: the page, its counts and this reader's own marks. */
  const historyRows = (filter: SQL | undefined) =>
    tx
      .select({
        message: messagingMessages,
        changeVersion: messagingChannelStreams.changeVersion,
        reactions: sql<unknown>`(select coalesce(jsonb_agg(jsonb_build_object(
            'reaction', grouped.reaction, 'count', grouped.total, 'own', grouped.own
          ) order by grouped.reaction), '[]'::jsonb) from (
            select r.reaction, count(*)::integer as total, bool_or(r.actor_id = ${input.actorId}) as own
            from public.messaging_reactions r
            where r.channel_id = ${messagingMessages.channelId} and r.message_id = ${messagingMessages.id}
            group by r.reaction
          ) grouped)`,
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
      const rows = await historyRows(
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
      const result = historyPage(
        required(rows).map((row) => ({
          ...row,
          reactions: reactionRowSchema.parse(row.reactions ?? []),
        })),
        limit,
        input.channelId,
      );
      const [position] = await tx
        .select({
          readSequence: sql<number>`coalesce((select ${messagingActorStates.readSequence} from ${messagingActorStates}
            where ${messagingActorStates.channelId} = ${input.channelId} and ${messagingActorStates.actorId} = ${input.actorId}), 0)`,
          firstUnreadSequence: sql<
            number | null
          >`(select min(unread.sequence) from ${messagingMessages} unread
            where unread.channel_id = ${input.channelId} and unread.author_actor_id <> ${input.actorId}
              and unread.removed_at is null
              and unread.sequence > coalesce((select ${messagingActorStates.readSequence} from ${messagingActorStates}
                where ${messagingActorStates.channelId} = ${input.channelId} and ${messagingActorStates.actorId} = ${input.actorId}), 0))`,
        })
        .from(messagingChannelStreams)
        .where(eq(messagingChannelStreams.channelId, input.channelId));
      if (!position) throw createAppError('NOT_FOUND');
      const { ownReactions, ...shared } = result;
      return {
        ...shared,
        viewer: {
          readSequence: Number(position.readSequence),
          firstUnreadSequence:
            position.firstUnreadSequence === null
              ? null
              : Number(position.firstUnreadSequence),
          ownReactions,
        },
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
