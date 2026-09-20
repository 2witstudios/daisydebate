import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq, and, sql } from 'drizzle-orm';
import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { users } from './schema/users';
import { debates } from './schema/debates';
import { accounts, passkeys, sessions, verifications } from './schema/auth';
export type DebateRecord = {
  readonly id: string;
  readonly createdBy: string | null;
  readonly resolution: string;
  readonly format: string;
  readonly snapshot: unknown;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
};
export type NewDebate = {
  readonly id: string;
  readonly createdBy?: string | null;
  readonly resolution: string;
  readonly format: string;
  readonly snapshot: unknown;
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
    async createDebate(input: NewDebate): Promise<DebateRecord> {
      try {
        return await database.transaction(async (tx) => {
          const [row] = await tx
            .insert(debates)
            .values({ ...input, createdBy: input.createdBy ?? null })
            .returning();
          if (!row) throw new Error('Debate insert returned no row');
          return row;
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
        return row ?? null;
      } catch (error) {
        reportFailure('getDebate');
        throw error;
      }
    },
    /** Null means optimistic conflict or absent record. Retry only after re-reading and re-running the domain operation. */
    async saveSnapshot(input: {
      id: string;
      expectedVersion: number;
      snapshot: unknown;
      updatedAt: string;
    }): Promise<DebateRecord | null> {
      try {
        const [row] = await database
          .update(debates)
          .set({
            snapshot: input.snapshot,
            version: sql`${debates.version}+1`,
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(debates.id, input.id),
              eq(debates.version, input.expectedVersion),
            ),
          )
          .returning();
        return row ?? null;
      } catch (error) {
        reportFailure('saveSnapshot');
        throw error;
      }
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
