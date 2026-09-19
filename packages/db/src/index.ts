import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { eq, and, sql } from 'drizzle-orm';
import { users } from './schema/users';
import { debates } from './schema/debates';
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
export function createDatabase({
  url,
  maxConnections = 10,
}: {
  url: string;
  maxConnections?: number;
}) {
  const client = new SQL(url, {
    max: maxConnections,
    connectionTimeout: 3,
    idleTimeout: 20,
    connection: { statement_timeout: 5000, lock_timeout: 2000 },
  });
  const database = drizzle({ client });
  return {
    async health() {
      await database.execute(sql`select 1`);
      return true;
    },
    async close() {
      await client.close({ timeout: 5 });
    },
    async createUser(input: { id: string; username: string }) {
      const [row] = await database.insert(users).values(input).returning();
      if (!row) throw new Error('User insert returned no row');
      return row;
    },
    async createDebate(input: NewDebate): Promise<DebateRecord> {
      return database.transaction(async (tx) => {
        const [row] = await tx
          .insert(debates)
          .values({ ...input, createdBy: input.createdBy ?? null })
          .returning();
        if (!row) throw new Error('Debate insert returned no row');
        return row;
      });
    },
    async getDebate(id: string): Promise<DebateRecord | null> {
      const [row] = await database
        .select()
        .from(debates)
        .where(eq(debates.id, id))
        .limit(1);
      return row ?? null;
    },
    /** Null means optimistic conflict or absent record. Retry only after re-reading and re-running the domain operation. */
    async saveSnapshot(input: {
      id: string;
      expectedVersion: number;
      snapshot: unknown;
      updatedAt: string;
    }): Promise<DebateRecord | null> {
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
    },
  };
}
export type Database = ReturnType<typeof createDatabase>;
