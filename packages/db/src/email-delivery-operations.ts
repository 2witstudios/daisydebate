import type { BunSQLDatabase } from 'drizzle-orm/bun-sql';
import { and, eq, lt, sql } from 'drizzle-orm';
import { verifications } from './schema/auth';
import {
  emailDeliveries,
  emailDeliveryEvents,
  emailSuppressions,
} from './schema/email-delivery';
import { instrumented, type DatabaseEventSink } from './instrumented';

/**
 * The email area (ISSUE-8 AC1, ADR 0025): delivery ledger, suppressions and
 * verification retention, composed into `createDatabase`.
 */
export const emailDeliveryOperations = ({
  database,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly eventSink?: DatabaseEventSink | undefined;
}) => ({
  /**
   * Retention (AUTH-7.5a): deletes at most `limit` verification rows whose
   * expiry is before `before`. The batch is chosen by an expiry predicate
   * live rows can never satisfy, and `SKIP LOCKED` lets concurrent workers
   * split a backlog without waiting on or double-deleting each other.
   * Returns the number deleted; a missing, fractional or non-positive
   * limit, or an unparsable cutoff, is refused.
   */
  async purgeExpiredVerifications(input: { before: string; limit: number }) {
    if (
      !Number.isSafeInteger(input.limit) ||
      input.limit < 1 ||
      Number.isNaN(Date.parse(input.before))
    )
      throw new Error('Invalid verification purge bounds');
    return instrumented(eventSink, 'purgeExpiredVerifications', async () => {
      const deleted = await database.execute(
        sql`delete from ${verifications} where ${verifications.id} in (
        select ${verifications.id} from ${verifications}
        where ${verifications.expiresAt} < ${input.before}::timestamptz
        order by ${verifications.expiresAt}
        limit ${input.limit}
        for update skip locked
      ) returning ${verifications.id}`,
      );
      return deleted.length;
    });
  },
  /** Idempotent: a retried send with the same provider message ID is a no-op. */
  async recordEmailDelivery(input: {
    providerMessageId: string;
    recipientHash: string;
    at: string;
  }) {
    return instrumented(eventSink, 'recordEmailDelivery', async () => {
      await database
        .insert(emailDeliveries)
        .values({
          providerMessageId: input.providerMessageId,
          recipientHash: input.recipientHash,
          status: 'sent',
          statusRank: 1,
          createdAt: input.at,
          updatedAt: input.at,
        })
        .onConflictDoNothing();
    });
  },
  async isRecipientSuppressed(recipientHash: string) {
    return instrumented(eventSink, 'isRecipientSuppressed', async () => {
      const [row] = await database
        .select({ recipientHash: emailSuppressions.recipientHash })
        .from(emailSuppressions)
        .where(eq(emailSuppressions.recipientHash, recipientHash))
        .limit(1);
      return row !== undefined;
    });
  },
  /**
   * One transaction: dedupe by provider event ID, raise (never lower) the
   * delivery rank, and record a suppression for hard failures. An event for
   * an unrecorded message rolls back its dedupe row so the provider's retry
   * is applied once the send is recorded.
   */
  async applyEmailDeliveryEvent(input: {
    eventId: string;
    providerMessageId: string;
    status: string;
    rank: number;
    suppress: 'bounce' | 'complaint' | null;
    at: string;
  }): Promise<'applied' | 'duplicate' | 'unknown-message'> {
    const unknown = Symbol('unknown-message');
    try {
      return await database.transaction(async (tx) => {
        const inserted = await tx
          .insert(emailDeliveryEvents)
          .values({
            providerEventId: input.eventId,
            providerMessageId: input.providerMessageId,
            receivedAt: input.at,
          })
          .onConflictDoNothing()
          .returning({ id: emailDeliveryEvents.providerEventId });
        if (inserted.length === 0) return 'duplicate' as const;
        const [delivery] = await tx
          .select({
            recipientHash: emailDeliveries.recipientHash,
          })
          .from(emailDeliveries)
          .where(eq(emailDeliveries.providerMessageId, input.providerMessageId))
          .limit(1);
        if (!delivery) throw unknown;
        await tx
          .update(emailDeliveries)
          .set({
            status: input.status,
            statusRank: input.rank,
            updatedAt: input.at,
          })
          .where(
            and(
              eq(emailDeliveries.providerMessageId, input.providerMessageId),
              lt(emailDeliveries.statusRank, input.rank),
            ),
          );
        if (input.suppress)
          await tx
            .insert(emailSuppressions)
            .values({
              recipientHash: delivery.recipientHash,
              reason: input.suppress,
              providerMessageId: input.providerMessageId,
              createdAt: input.at,
            })
            .onConflictDoNothing();
        return 'applied' as const;
      });
    } catch (error) {
      if (error === unknown) return 'unknown-message';
      eventSink?.(
        'db.query.failed',
        { operation: 'applyEmailDeliveryEvent' },
        'Database query failed',
      );
      throw error;
    }
  },
});
