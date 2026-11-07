import { sql } from 'drizzle-orm';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { requireRetentionBounds, type RetentionBatch } from '../retention';

/** Terminal-end cutoff, supplied as now minus the fixed 180-day floor window. Counters survive. */
export function roundFloorRetention(database: Pick<BunSQLDatabase, 'execute'>) {
  return {
    async purgeExpiredRoundFloorMessages(input: RetentionBatch) {
      requireRetentionBounds(input);
      const rows = await database.execute(sql`with due as (
        select m.id,m.channel_id from messaging_messages m
        join messaging_channels c on c.id=m.channel_id and c.kind='round_floor'
        join rounds r on r.id=c.round_id
        where r.status in ('completed','abandoned') and r.completed_at<=${input.before}::timestamptz
          and not exists(select 1 from messaging_receipts x where x.channel_id=m.channel_id and x.message_id=m.id)
          and not exists(select 1 from messaging_messages reply where reply.channel_id=m.channel_id and reply.reply_to_message_id=m.id)
        order by m.channel_id,m.sequence desc limit ${input.limit} for update of m skip locked
      ) delete from messaging_messages m using due where m.id=due.id and m.channel_id=due.channel_id returning m.id`);
      return rows.length;
    },
    async purgeExpiredRoundFloorReceipts(input: RetentionBatch) {
      requireRetentionBounds(input);
      const rows =
        await database.execute(sql`delete from messaging_receipts x where (x.channel_id,x.actor_id,x.request_id) in (
    select q.channel_id,q.actor_id,q.request_id from messaging_receipts q join messaging_channels c on c.id=q.channel_id and c.kind='round_floor' join rounds r on r.id=c.round_id where r.status in ('completed','abandoned') and r.completed_at<=${input.before}::timestamptz order by q.channel_id,q.actor_id,q.request_id limit ${input.limit} for update of q skip locked
   ) returning x.channel_id`);
      return rows.length;
    },
    async purgeExpiredRoundFloorReadStates(input: RetentionBatch) {
      requireRetentionBounds(input);
      const rows =
        await database.execute(sql`delete from messaging_actor_states s where (s.channel_id,s.actor_id) in (
    select x.channel_id,x.actor_id from messaging_actor_states x join messaging_channels c on c.id=x.channel_id and c.kind='round_floor' join rounds r on r.id=c.round_id where r.status in ('completed','abandoned') and r.completed_at<=${input.before}::timestamptz order by x.channel_id,x.actor_id limit ${input.limit} for update of x skip locked
   ) returning s.channel_id`);
      return rows.length;
    },
  };
}
