import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq, and, ne, sql } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { formatRulesSchema, type FormatRules } from '@daisy/protocol';
import { users } from './schema/users';
import { claimUsername } from './username-claim';
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
export type { UsernameClaim } from './username-claim';
export type FormatRecord = {
  readonly id: string;
  readonly rules: FormatRules;
  readonly rankedEligible: boolean;
};
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
    ...emailDeliveryOperations({ database, reportFailure }),
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
    /**
     * Revokes every session for `userId` except `keepToken` in one atomic
     * DELETE — no snapshot-then-delete round trips, so a session created
     * concurrently with this call cannot slip through a listing window.
     * Returns the number of sessions removed.
     */
    async revokeOtherSessions(
      userId: string,
      keepToken: string,
    ): Promise<number> {
      try {
        const rows = await database
          .delete(sessions)
          .where(
            and(eq(sessions.userId, userId), ne(sessions.token, keepToken)),
          )
          .returning({ id: sessions.id });
        return rows.length;
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
