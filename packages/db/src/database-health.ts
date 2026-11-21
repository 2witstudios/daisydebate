import type { SQL } from 'bun';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { probeListen } from './listen';
import {
  tenantIsolationProblems,
  tenantIsolationFactsSql,
  tenantTableFactsRow,
} from './tenant-isolation';
import {
  tenantDefinerFactsSql,
  tenantDefinerFactsRow,
  tenantDefinerProblems,
} from './tenant-definers';
import { readImageSchema, startupSchemaProblems } from './startup-schema';
import { tenantIsolationManifest } from './tenant-isolation-manifest';
import {
  runtimeRoleFactsFrom,
  runtimeRoleFactsQuery,
  runtimeRoleProblems,
  runtimeRoleFactsRow,
} from './runtime-role';
import { inTransaction, type TxSource } from './tx';
import { query, run } from './raw-rows';

/** Connection/role probes for doctor, startup and health checks over the owned pool. */
export const databaseHealthOperations = ({
  database,
  dedicated,
  eventSink,
}: {
  readonly database: TxSource;
  /** LISTEN probes need a connection outside every lane. */
  readonly dedicated: SQL;
  readonly eventSink: DatabaseEventSink | undefined;
}) => ({
  async health() {
    return instrumented(eventSink, 'health', async () => {
      await run(database, sql`select 1`);
      return true;
    });
  },
  /**
   * The database this connection actually landed on, from the server
   * itself (`current_database()`), never parsed back out of `url`.
   */
  async currentDatabaseName(): Promise<string> {
    return instrumented(eventSink, 'currentDatabaseName', async () => {
      const [row] = await query(
        database,
        z.object({ name: z.string() }),
        sql`select current_database() as name`,
      );
      if (!row) throw new Error('Current database is unreadable');
      return row.name;
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
      const [row] = await query(
        database,
        runtimeRoleFactsRow,
        runtimeRoleFactsQuery,
      );
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
      if (!acceptNewerMigrations) {
        const facts = await query(
          database,
          tenantTableFactsRow,
          sql.raw(tenantIsolationFactsSql),
        );
        const definers = await query(
          database,
          tenantDefinerFactsRow,
          sql.raw(tenantDefinerFactsSql),
        );
        return [
          ...tenantIsolationProblems(facts, tenantIsolationManifest),
          ...tenantDefinerProblems(definers, tenantIsolationManifest),
        ];
      }
      const image = await readImageSchema();
      return inTransaction(
        database,
        async (tx) => {
          const journal = await query(
            tx,
            z.object({
              hash: z.string(),
              createdAt: z
                .union([z.string().regex(/^\d+$/), z.bigint(), z.number()])
                .pipe(z.coerce.number())
                .pipe(z.int()),
            }),
            sql`select hash, created_at as "createdAt" from drizzle.__drizzle_migrations order by created_at, id`,
          );
          const facts = await query(
            tx,
            tenantTableFactsRow,
            sql.raw(tenantIsolationFactsSql),
          );
          const definers = await query(
            tx,
            tenantDefinerFactsRow,
            sql.raw(tenantDefinerFactsSql),
          );
          return startupSchemaProblems({
            image,
            journal,
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
