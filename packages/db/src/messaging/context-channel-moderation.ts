import { sql, type SQL } from 'drizzle-orm';
import type { AuthorizationTransaction } from '../authorization';
import type { BoundedTransactionContext } from '../transaction-context';
import type {
  ContextChannelFact,
  ContextChannelKind,
} from './context-channel-contracts';
import { appendStream, lockStream } from './stream';

/** What one context supplies so reports and operators can reach its messages. */
export type ContextChannelModerationOwner<Fact extends ContextChannelFact> = {
  readonly kind: ContextChannelKind;
  /** The channel column naming this context's owner. */
  readonly ownerColumn: SQL;
  /** True while an operator may still read a reported message of channel `c`. */
  readonly subjectReadable: SQL;
  readonly fence: (
    tx: AuthorizationTransaction,
    ownerId: string,
  ) => Promise<boolean>;
  readonly readFact: (
    tx: AuthorizationTransaction,
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
      tx: BoundedTransactionContext,
      input: { readonly messageId: string; readonly reporterActorId: string },
    ) {
      const [row] = await tx.execute(
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
    async readSubject(tx: BoundedTransactionContext, messageId: string) {
      const [row] = await tx.execute(
        sql`select m.text,a.user_id as "authorUserId" from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind=${owner.kind} join actors a on a.id=m.author_actor_id where m.id=${messageId} and ${owner.subjectReadable}`,
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
        sql`select ${owner.ownerColumn} as owner_id,c.id from messaging_messages m join messaging_channels c on c.id=m.channel_id and c.kind=${owner.kind} where m.id=${input.messageId}`,
      );
      if (
        !found ||
        typeof found.owner_id !== 'string' ||
        typeof found.id !== 'string'
      )
        return null;
      await owner.fence(tx, found.owner_id);
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
}
