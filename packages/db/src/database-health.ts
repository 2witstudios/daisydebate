import type { SQL } from 'bun';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sql } from 'drizzle-orm';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { probeListen } from './listen';
import {
  readTenantIsolationProblems,
  tenantIsolationFactsSql,
  type TenantTableFacts,
} from './tenant-isolation';
import {
  tenantDefinerFactsSql,
  type TenantDefinerFacts,
} from './tenant-definers';
import {
  readImageSchema,
  startupSchemaProblems,
  type MigrationStamp,
} from './startup-schema';
import { tenantIsolationManifest } from './tenant-isolation-manifest';
import {
  runtimeRoleFactsFrom,
  runtimeRoleFactsQuery,
  runtimeRoleProblems,
  type RuntimeRoleFactsRow,
} from './runtime-role';

/** Connection/role probes for doctor, startup and health checks over the owned pool. */
export const databaseHealthOperations = ({
  database,
  dedicated,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  /** LISTEN probes need a connection outside every lane. */
  readonly dedicated: SQL;
  readonly eventSink: DatabaseEventSink | undefined;
}) => ({
  async health() {
    return instrumented(eventSink, 'health', async () => {
      await database.execute(sql`select 1`);
      return true;
    });
  },
  /**
   * The database this connection actually landed on, from the server
   * itself (`current_database()`), never parsed back out of `url`.
   */
  async currentDatabaseName(): Promise<string> {
    return instrumented(eventSink, 'currentDatabaseName', async () => {
      const [row] = (await database.execute(
        sql`select current_database() as name`,
      )) as unknown as Array<{ name: string }>;
      return row!.name;
    });
  },
  async checkListen() {
    return instrumented(eventSink, 'checkListen', async () => {
      await probeListen(dedicated);
      return true;
    });
  },
  /**
   * How the connected role could create or alter schema objects in
   * `public` (ISSUE-39); empty for the DML-only runtime role. Production
   * startup refuses to serve unless it is empty.
   */
  async runtimeRoleProblems() {
    return instrumented(eventSink, 'runtimeRoleProblems', async () => {
      const [row] = (await database.execute(
        runtimeRoleFactsQuery,
      )) as unknown as RuntimeRoleFactsRow[];
      // No row means no schema public: nothing proves the role is safe.
      if (row === undefined) throw new Error('Schema public is missing');
      return runtimeRoleProblems(runtimeRoleFactsFrom(row));
    });
  },
  /**
   * Every way this schema's tenant fence differs from the manifest; empty
   * when each table that carries or references a tenant key has its
   * row-level security policies. Production startup refuses to serve unless
   * it is empty.
   */
  async tenantIsolationProblems({
    acceptNewerMigrations = false,
  } = {}): Promise<readonly string[]> {
    return instrumented(eventSink, 'tenantIsolationProblems', async () => {
      if (!acceptNewerMigrations)
        return readTenantIsolationProblems((statement) =>
          database.execute(sql.raw(statement)),
        );
      const image = await readImageSchema();
      return database.transaction(
        async (tx) => {
          const journal = (await tx.execute(
            sql`select hash, created_at as "createdAt" from drizzle.__drizzle_migrations order by created_at, id`,
          )) as unknown as MigrationStamp[];
          const facts = (await tx.execute(
            sql.raw(tenantIsolationFactsSql),
          )) as unknown as TenantTableFacts[];
          const definers = (await tx.execute(
            sql.raw(tenantDefinerFactsSql),
          )) as unknown as TenantDefinerFacts[];
          return startupSchemaProblems({
            image,
            journal: journal.map(({ hash, createdAt }) => ({
              hash,
              createdAt: Number(createdAt),
            })),
            facts,
            definers,
            manifest: tenantIsolationManifest,
          });
        },
        { isolationLevel: 'repeatable read', accessMode: 'read only' },
      );
    });
  },
});
