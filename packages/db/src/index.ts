import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq, and, ne, sql } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import {
  formatRulesSchema,
  buildUserInboxTopic,
  type FormatRules,
} from '@daisy/protocol';
import { probeListen } from './listen';
import { users } from './schema/users';
import { claimUsername } from './username-claim';
import { actorOperations, queryActorByUserId } from './actor-operations';
import { formats } from './schema/formats';
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
import { emailDeliveryOperations } from './email-delivery-operations';
import { appendOutboxEvent, purgeExpiredOutboxEvents } from './outbox';
export {
  appendOutboxEvent,
  drainOutbox,
  encodeOutboxCursor,
  decodeOutboxCursor,
  OUTBOX_ORIGIN,
  type OutboxAppendInput,
  type OutboxPosition,
  type OutboxRow,
} from './outbox';
export { outbox } from './schema/outbox';
export type { UsernameClaim } from './username-claim';
export type { ActorRecord } from './actor-operations';
export type FormatRecord = {
  readonly id: string;
  readonly rules: FormatRules;
  readonly rankedEligible: boolean;
};
export type DatabaseEventSink = (
  event: 'db.query.failed' | 'realtime.outbox.actor_missing',
  fields: Readonly<Record<string, unknown>>,
  message: string,
) => void;
export function createDatabase({
  url,
  maxConnections = 10,
  eventSink,
  client: injectedClient,
  nextActorId,
}: {
  url: string;
  maxConnections?: number;
  eventSink?: DatabaseEventSink;
  /** Overrides dialing `url`; tests inject a scripted client at this seam. */
  client?: SQL;
  /**
   * The cuid2 source for actor rows created at onboarding (ACTOR-1). Required,
   * not defaulted: every caller states its id strategy explicitly rather than
   * silently falling back to an ambient one. The application edge injects its
   * clock/id source (`@daisy/clock`'s `systemId.next`); a caller with no
   * production writes of its own (a read-only script, a fixture) still names
   * one, such as `@paralleldrive/cuid2`'s `createId` directly.
   */
  nextActorId: () => string;
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
  /**
   * Plan revision 4.10: revocation rows are keyed by `actors.id`, never
   * `users.id`. `claimUsername` inserts the actor when a username claim
   * succeeds (ACTOR-1), so a user who never claimed a username is the only
   * one with no actor row; that is a known, permanent case, not a thrown
   * error. Shares its query with `getActorByUserId`
   * (`actor-operations.ts`'s `queryActorByUserId`) — one lookup, not a
   * second hand-rolled one — passing this call's own `tx` so the read joins
   * whatever write follows in the same transaction.
   */
  const findActorId = async (
    tx: Pick<typeof database, 'select'>,
    userId: string,
    operation: string,
  ): Promise<string | null> => {
    const actor = await queryActorByUserId(tx, userId);
    if (!actor)
      eventSink?.(
        'realtime.outbox.actor_missing',
        { operation },
        'No actor row for this user (never claimed a username); revocation outbox row not appended',
      );
    return actor?.id ?? null;
  };
  return {
    authAdapter,
    /**
     * Exposes the driver transaction so a caller can compose its own write
     * with `appendOutboxEvent` atomically (RT-2.2: the outbox row commits
     * only alongside the write it announces).
     */
    transaction: database.transaction.bind(database),
    /**
     * RT-2.2 (plan revision 4.1, ADR 0032 §5): appends one `session.revoked`
     * outbox row in its own short transaction, for a caller that has already
     * confirmed a session delete outside Daisy's control (Better Auth's own
     * revoke endpoints). Never wraps the delete itself.
     *
     * Plan revision 4.10: resolves the actor through `actors.user_id` (never
     * keys anything by `userId`); a user with no actor row (never claimed a
     * username) appends nothing and logs `realtime.outbox.actor_missing`.
     */
    async appendSessionRevoked(userId: string) {
      try {
        await database.transaction(async (tx) => {
          const actorId = await findActorId(tx, userId, 'appendSessionRevoked');
          if (!actorId) return;
          await appendOutboxEvent(tx, {
            topic: buildUserInboxTopic(actorId),
            kind: 'session.revoked',
            version: 1,
            payload: { version: 1, kind: 'session.revoked', ids: [actorId] },
          });
        });
      } catch (error) {
        reportFailure('appendSessionRevoked');
        throw error;
      }
    },
    async health() {
      try {
        await database.execute(sql`select 1`);
      } catch (error) {
        reportFailure('health');
        throw error;
      }
      return true;
    },
    async checkListen() {
      try {
        await probeListen(client);
      } catch (error) {
        reportFailure('checkListen');
        throw error;
      }
      return true;
    },
    async close() {
      await client.close({ timeout: 5 });
    },
    ...emailDeliveryOperations({ database, reportFailure }),
    ...actorOperations({ database, reportFailure }),
    async purgeExpiredOutboxEvents(input: { before: string; limit: number }) {
      try {
        return await purgeExpiredOutboxEvents(database, input);
      } catch (error) {
        reportFailure('purgeExpiredOutboxEvents');
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
      claimUsername(database, input, nextActorId, reportFailure),
    /**
     * Revokes every session for `userId` except `keepToken` in one atomic
     * DELETE — no snapshot-then-delete round trips, so a session created
     * concurrently with this call cannot slip through a listing window.
     * This is Daisy's own operation (AUTH-5.6's email-change completion),
     * not one of Better Auth's internal deletes, so the `session.revoked`
     * append happens in the *same* transaction as the DELETE (ADR 0032 §5,
     * plan revision 4.7): unlike the after-hook writers, a failed append
     * here rolls the DELETE back too, rather than being swallowed
     * best-effort. Returns the number of sessions removed.
     *
     * Plan revision 4.10: resolves the actor through `actors.user_id`; a
     * user with no actor row (never claimed a username) still has its
     * sessions revoked, but appends nothing and logs
     * `realtime.outbox.actor_missing` instead.
     */
    async revokeOtherSessions(
      userId: string,
      keepToken: string,
    ): Promise<number> {
      try {
        return await database.transaction(async (tx) => {
          const rows = await tx
            .delete(sessions)
            .where(
              and(eq(sessions.userId, userId), ne(sessions.token, keepToken)),
            )
            .returning({ id: sessions.id });
          if (rows.length > 0) {
            const actorId = await findActorId(
              tx,
              userId,
              'revokeOtherSessions',
            );
            if (actorId)
              await appendOutboxEvent(tx, {
                topic: buildUserInboxTopic(actorId),
                kind: 'session.revoked',
                version: 1,
                payload: {
                  version: 1,
                  kind: 'session.revoked',
                  ids: [actorId],
                },
              });
          }
          return rows.length;
        });
      } catch (error) {
        reportFailure('revokeOtherSessions');
        throw error;
      }
    },
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
    /**
     * The canonical rules of a format (ADR 0030). Callers copy them into a
     * new debate's snapshot; a lobby may then override, ranked may not.
     */
    async getFormat(id: string): Promise<FormatRecord | null> {
      try {
        const [row] = await database
          .select({
            id: formats.id,
            rules: formats.rules,
            rankedEligible: formats.rankedEligible,
          })
          .from(formats)
          .where(eq(formats.id, id))
          .limit(1);
        if (!row) return null;
        const rules = formatRulesSchema.safeParse(row.rules);
        if (!rules.success) throw new Error('Stored format rules are invalid');
        return {
          id: row.id,
          rules: rules.data,
          rankedEligible: row.rankedEligible,
        };
      } catch (error) {
        reportFailure('getFormat');
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
