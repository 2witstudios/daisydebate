import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq, and, lt, sql } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { users } from './schema/users';
import { claimUsername } from './username-claim';
import { debates, type DebateOutcome } from './schema/debates';
import {
  snapshotPhase,
  toDebateRecord,
  type DebateRecord,
  type NewDebate,
} from './debate-record';
export type {
  DebateMode,
  DebateOutcome,
  DebateVisibility,
} from './schema/debates';
export type { DebateRecord, NewDebate } from './debate-record';
import { accounts, passkeys, sessions, verifications } from './schema/auth';
import {
  emailDeliveries,
  emailDeliveryEvents,
  emailSuppressions,
} from './schema/email-delivery';
export type { UsernameClaim } from './username-claim';
export type DatabaseEventSink = (
  event: 'db.query.failed',
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;
export function createDatabase({
  url,
  maxConnections = 10,
  eventSink,
  client: injectedClient,
}: {
  url: string;
  maxConnections?: number;
  eventSink?: DatabaseEventSink;
  /** Overrides dialing `url`; tests inject a scripted client at this seam. */
  client?: SQL;
}) {
  const client =
    injectedClient ??
    new SQL(url, {
      max: maxConnections,
      connectionTimeout: 3,
      idleTimeout: 20,
      connection: { statement_timeout: 5000, lock_timeout: 2000 },
    });
  const database = drizzle({ client });
  const authAdapter = drizzleAdapter(database, {
    provider: 'pg',
    schema: {
      user: users,
      session: sessions,
      account: accounts,
      verification: verifications,
      passkey: passkeys,
    },
  });
  const reportFailure = (operation: string) =>
    eventSink?.('db.query.failed', { operation }, 'Database query failed');
  return {
    authAdapter,
    async health() {
      try {
        await database.execute(sql`select 1`);
      } catch (error) {
        reportFailure('health');
        throw error;
      }
      return true;
    },
    async close() {
      await client.close({ timeout: 5 });
    },
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
      try {
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
      } catch (error) {
        reportFailure('purgeExpiredVerifications');
        throw error;
      }
    },
    /** Idempotent: a retried send with the same provider message ID is a no-op. */
    async recordEmailDelivery(input: {
      providerMessageId: string;
      recipientHash: string;
      at: string;
    }) {
      try {
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
      } catch (error) {
        reportFailure('recordEmailDelivery');
        throw error;
      }
    },
    async isRecipientSuppressed(recipientHash: string) {
      try {
        const [row] = await database
          .select({ recipientHash: emailSuppressions.recipientHash })
          .from(emailSuppressions)
          .where(eq(emailSuppressions.recipientHash, recipientHash))
          .limit(1);
        return row !== undefined;
      } catch (error) {
        reportFailure('isRecipientSuppressed');
        throw error;
      }
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
            .where(
              eq(emailDeliveries.providerMessageId, input.providerMessageId),
            )
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
        reportFailure('applyEmailDeliveryEvent');
        throw error;
      }
    },
    async createUser(input: { id: string; username: string }) {
      try {
        const [row] = await database.insert(users).values(input).returning();
        if (!row) throw new Error('User insert returned no row');
        return row;
      } catch (error) {
        reportFailure('createUser');
        throw error;
      }
    },
    /** Server-owned onboarding claim; see `claimUsername`. */
    claimUsername: (input: { userId: string; username: string }) =>
      claimUsername(database, input, reportFailure),
    async createDebate(input: NewDebate): Promise<DebateRecord> {
      const phase = snapshotPhase(input.snapshot);
      try {
        return await database.transaction(async (tx) => {
          const [row] = await tx
            .insert(debates)
            .values({ ...input, phase, createdBy: input.createdBy ?? null })
            .returning();
          if (!row) throw new Error('Debate insert returned no row');
          return toDebateRecord(row);
        });
      } catch (error) {
        reportFailure('createDebate');
        throw error;
      }
    },
    async getDebate(id: string): Promise<DebateRecord | null> {
      try {
        const [row] = await database
          .select()
          .from(debates)
          .where(eq(debates.id, id))
          .limit(1);
        return row ? toDebateRecord(row) : null;
      } catch (error) {
        reportFailure('getDebate');
        throw error;
      }
    },
    /**
     * Null means optimistic conflict or absent record; retry only after
     * re-reading and re-running the domain operation. Lifecycle projections
     * travel in the same UPDATE (ADR 0029): `phase` from the snapshot,
     * `started_at` on the first save that becomes `active`, `completed_at`
     * plus the caller's `outcome` on completion. An outcome is required when
     * completing and refused otherwise, before any statement runs.
     */
    async saveSnapshot(input: {
      id: string;
      expectedVersion: number;
      snapshot: unknown;
      updatedAt: string;
      outcome?: DebateOutcome;
    }): Promise<DebateRecord | null> {
      const phase = snapshotPhase(input.snapshot);
      const completing = phase === 'completed';
      const hasOutcome = input.outcome !== undefined;
      if (completing !== hasOutcome)
        throw new Error('An outcome is required exactly when completing');
      const updatedAt = new Date(input.updatedAt);
      try {
        const [row] = await database
          .update(debates)
          .set({
            snapshot: input.snapshot,
            version: sql`${debates.version}+1`,
            updatedAt,
            phase,
            // Completion leaves started_at as it is: a debate abandoned from
            // waiting never started, and the CHECK decides what is legal.
            ...(phase === 'waiting' && { startedAt: null }),
            ...(phase === 'active' && {
              startedAt: sql`coalesce(${debates.startedAt}, ${updatedAt})`,
            }),
            completedAt: completing
              ? sql`coalesce(${debates.completedAt}, ${updatedAt})`
              : null,
            outcome: input.outcome ?? null,
          })
          .where(
            and(
              eq(debates.id, input.id),
              eq(debates.version, input.expectedVersion),
            ),
          )
          .returning();
        return row ? toDebateRecord(row) : null;
      } catch (error) {
        reportFailure('saveSnapshot');
        throw error;
      }
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
