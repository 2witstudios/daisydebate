import { sql, type SQL } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { requireRetentionBounds, type RetentionBatch } from '../retention';
import type { ContextChannelKind } from './context-channel-contracts';

/**
 * One context's bounded purges once its owner has ended. `ended` joins channel
 * `c` to its owner and admits it when the owner ended at or before the cutoff.
 * Receipts drain first, then message leaves (a replied-to message waits for
 * its replies), then read state. Stream counters survive.
 */
export function contextChannelRetention(
  database: Pick<BunSQLDatabase, 'execute'>,
  kind: ContextChannelKind,
  ended: (before: string) => SQL,
) {
  return {
    async purgeMessages(input: RetentionBatch) {
      requireRetentionBounds(input);
      const rows = await database.execute(sql`with due as (
        select m.id,m.channel_id from messaging_messages m
        join messaging_channels c on c.id=m.channel_id and c.kind=${kind}
        ${ended(input.before)}
          and not exists(select 1 from messaging_receipts x where x.channel_id=m.channel_id and x.message_id=m.id)
          and not exists(select 1 from messaging_messages reply where reply.channel_id=m.channel_id and reply.reply_to_message_id=m.id)
        order by m.channel_id,m.sequence desc limit ${input.limit} for update of m skip locked
      ) delete from messaging_messages m using due where m.id=due.id and m.channel_id=due.channel_id returning m.id`);
      return rows.length;
    },
    async purgeReceipts(input: RetentionBatch) {
      requireRetentionBounds(input);
      // The batch is a CTE, as in purgeMessages: a locking LIMIT inside an IN
      // subquery may run again per row and delete past the limit.
      const rows = await database.execute(sql`with due as (
        select q.channel_id,q.actor_id,q.request_id from messaging_receipts q
        join messaging_channels c on c.id=q.channel_id and c.kind=${kind}
        ${ended(input.before)}
        order by q.channel_id,q.actor_id,q.request_id limit ${input.limit} for update of q skip locked
      ) delete from messaging_receipts x using due where x.channel_id=due.channel_id and x.actor_id=due.actor_id and x.request_id=due.request_id returning x.channel_id`);
      return rows.length;
    },
    async purgeReadStates(input: RetentionBatch) {
      requireRetentionBounds(input);
      const rows = await database.execute(sql`with due as (
        select x.channel_id,x.actor_id from messaging_actor_states x
        join messaging_channels c on c.id=x.channel_id and c.kind=${kind}
        ${ended(input.before)}
        order by x.channel_id,x.actor_id limit ${input.limit} for update of x skip locked
      ) delete from messaging_actor_states s using due where s.channel_id=due.channel_id and s.actor_id=due.actor_id returning s.channel_id`);
      return rows.length;
    },
  };
}
