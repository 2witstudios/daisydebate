import type { SQL } from 'bun';
import type { BunSQLDatabase } from 'drizzle-orm/bun-sql/postgres';
import { sql } from 'drizzle-orm';
import { instrumented, type DatabaseEventSink } from './instrumented';
import { probeListen } from './listen';
import {
  runtimeRoleFactsFrom,
  runtimeRoleFactsQuery,
  runtimeRoleProblems,
  type RuntimeRoleFactsRow,
} from './runtime-role';

/** Connection/role probes for doctor, startup and health checks over the owned pool. */
export const databaseHealthOperations = ({
  database,
  client,
  eventSink,
}: {
  readonly database: BunSQLDatabase;
  readonly client: SQL;
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
      await probeListen(client);
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
});
