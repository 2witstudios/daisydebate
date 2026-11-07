import { sql } from 'drizzle-orm';
import type { BoundedTransactionContext } from '../transaction-context';
import { readRoundFloorFact, fenceRoundFloor } from './round-floor-facts';
import { appendStream, lockStream } from './stream';

/** Named internal port. Reporting must compose the returned fact with current floor read authority. */
export const roundFloorModeration = {
  async readReportFacts(
    tx: BoundedTransactionContext,
    input: { readonly messageId: string; readonly reporterActorId: string },
  ) {
    const [row] = await tx.execute(
      sql`select c.round_id,m.author_actor_id from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind='round_floor' where m.id=${input.messageId} and m.text is not null and m.removed_at is null`,
    );
    if (!row || typeof row.round_id !== 'string') return null;
    const fact = await readRoundFloorFact(
      tx,
      row.round_id,
      input.reporterActorId,
    );
    return fact
      ? { ownMessage: row.author_actor_id === input.reporterActorId, fact }
      : null;
  },
  async readSubject(tx: BoundedTransactionContext, messageId: string) {
    const [row] = await tx.execute(
      sql`select m.text,a.user_id as "authorUserId" from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind='round_floor' join actors a on a.id=m.author_actor_id join rounds r on r.id=c.round_id where m.id=${messageId} and (r.completed_at is null or clock_timestamp()<r.completed_at+interval '180 days')`,
    );
    return row
      ? {
          text: row.text as string | null,
          authorUserId: row.authorUserId as string | null,
        }
      : null;
  },
  async remove(
    tx: BoundedTransactionContext,
    input: { readonly messageId: string; readonly now: Date },
  ) {
    const [found] = await tx.execute(
      sql`select c.round_id,c.id from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind='round_floor' where m.id=${input.messageId}`,
    );
    if (
      !found ||
      typeof found.round_id !== 'string' ||
      typeof found.id !== 'string'
    )
      return null;
    await fenceRoundFloor(tx, found.round_id);
    await tx.execute(
      sql`select id from messaging_channels where id=${found.id} for share`,
    );
    await lockStream(tx, found.id);
    const [current] = await tx.execute(
      sql`select removed_at from messaging_messages where id=${input.messageId} and channel_id=${found.id}`,
    );
    if (!current) return null;
    if (current.removed_at !== null) return 'unchanged' as const;
    const stream = await appendStream(tx, found.id, {
      messages: 0,
      changes: 1,
    });
    const [row] = await tx.execute(
      sql`update messaging_messages set text=null,removed_at=${input.now.toISOString()}::timestamptz,change_version=${stream.changeVersion} where id=${input.messageId} and channel_id=${found.id} and removed_at is null returning id`,
    );
    if (!row) return 'unchanged' as const;
    await tx.execute(
      sql`update messaging_receipts set payload_digest=null where channel_id=${found.id} and message_id=${input.messageId}`,
    );
    return 'applied' as const;
  },
};
