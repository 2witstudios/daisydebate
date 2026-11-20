import { sql, type SQL } from 'drizzle-orm';
import type {
  ContextChannelFact,
  ContextChannelKind,
} from './context-channel-contracts';
import { appendStream, lockStream } from './stream';
import type { Tx } from '../tx';
import { run, query } from '../raw-rows';
import { z } from 'zod';

/** What one context supplies so reports and operators can reach its messages. */
export type ContextChannelModerationOwner<Fact extends ContextChannelFact> = {
  readonly kind: ContextChannelKind;
  /** The channel column naming this context's owner. */
  readonly ownerColumn: SQL;
  /** True while an operator may still read a reported message of channel `c`. */
  readonly subjectReadable: SQL;
  readonly fence: (tx: Tx, ownerId: string) => Promise<boolean>;
  readonly readFact: (
    tx: Tx,
    ownerId: string,
    actorId: string,
  ) => Promise<Fact | null>;
};

/** Named internal port. Reporting must compose the returned fact with the context's current read authority. */
export function contextChannelModeration<Fact extends ContextChannelFact>(
  owner: ContextChannelModerationOwner<Fact>,
) {
  return {
    async readReportFacts(
      tx: Tx,
      input: { readonly messageId: string; readonly reporterActorId: string },
    ) {
      const [row] = await query(
        tx,
        z.object({
          owner_id: z.string().nullable(),
          author_actor_id: z.string(),
        }),
        sql`select ${owner.ownerColumn} as owner_id,m.author_actor_id from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind=${owner.kind} where m.id=${input.messageId} and m.text is not null and m.removed_at is null`,
      );
      if (!row || typeof row.owner_id !== 'string') return null;
      const fact = await owner.readFact(
        tx,
        row.owner_id,
        input.reporterActorId,
      );
      return fact
        ? { ownMessage: row.author_actor_id === input.reporterActorId, fact }
        : null;
    },
    async readSubject(tx: Tx, messageId: string) {
      const [row] = await query(
        tx,
        z.object({
          text: z.string().nullable(),
          authorUserId: z.string().nullable(),
        }),
        sql`select m.text,a.user_id as "authorUserId" from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind=${owner.kind} join actors a on a.id=m.author_actor_id where m.id=${messageId} and ${owner.subjectReadable}`,
      );
      return row
        ? {
            text: row.text,
            authorUserId: row.authorUserId,
          }
        : null;
    },
    async remove(
      tx: Tx,
      input: { readonly messageId: string; readonly now: Date },
    ) {
      const [found] = await query(
        tx,
        z.object({ owner_id: z.string().nullable(), id: z.string() }),
        sql`select ${owner.ownerColumn} as owner_id,c.id from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind=${owner.kind} where m.id=${input.messageId}`,
      );
      if (!found || found.owner_id === null) return null;
      await owner.fence(tx, found.owner_id);
      await run(
        tx,
        sql`select id from messaging_channels where id=${found.id} for share`,
      );
      await lockStream(tx, found.id);
      const [current] = await query(
        tx,
        z.object({ removed_at: z.date().nullable() }),
        sql`select removed_at from messaging_messages where id=${input.messageId} and channel_id=${found.id}`,
      );
      if (!current) return null;
      if (current.removed_at !== null) return 'unchanged' as const;
      const stream = await appendStream(tx, found.id, {
        messages: 0,
        changes: 1,
      });
      const [row] = await query(
        tx,
        z.object({ id: z.string() }),
        sql`update messaging_messages set text=null,removed_at=${input.now.toISOString()}::timestamptz,change_version=${stream.changeVersion} where id=${input.messageId} and channel_id=${found.id} and removed_at is null returning id`,
      );
      if (!row) return 'unchanged' as const;
      await run(
        tx,
        sql`update messaging_receipts set payload_digest=null where channel_id=${found.id} and message_id=${input.messageId}`,
      );
      return 'applied' as const;
    },
  };
}
