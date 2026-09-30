/**
 * The effectful half of one integration run's own database (ADR 0034,
 * ISSUE-238): sweep the databases dead runs left, make and migrate this
 * run's, hand its URL to the work, and always drop it afterwards. The
 * runner's single admin connection holds the run's liveness lock for the
 * whole call, so a run killed anywhere in it leaves a database the next
 * run's sweep drops. The run is migrated with this checkout's own migrator,
 * so every run also proves the migrations apply to an empty database.
 */
import { SQL } from 'bun';
import {
  claimTestRunDatabase,
  dropTestRunDatabase,
  sweepTestRunDatabases,
  testRunDatabaseName,
  testRunToken,
} from '@daisy/db/test-runs';

const withDatabase = (url: string, database: string): string => {
  const next = new URL(url);
  next.pathname = `/${database}`;
  return next.toString();
};

export async function withRunDatabase<T>({
  slotDatabaseUrl,
  root,
  onSweep,
  work,
}: {
  /** TEST_DATABASE_URL: the slot's `_test` database, which names the server and the run databases. */
  readonly slotDatabaseUrl: string;
  /** The checkout whose migrations the run applies. */
  readonly root: string;
  readonly onSweep: (dropped: readonly string[]) => void;
  readonly work: (runDatabaseUrl: string) => Promise<T>;
}): Promise<T> {
  const slotDatabase = decodeURIComponent(
    new URL(slotDatabaseUrl).pathname.slice(1),
  );
  const admin = new SQL(withDatabase(slotDatabaseUrl, 'postgres'), { max: 1 });
  const name = testRunDatabaseName(
    slotDatabase,
    testRunToken(crypto.getRandomValues(new Uint8Array(4))),
  );
  try {
    onSweep(await sweepTestRunDatabases(admin, slotDatabase));
    await claimTestRunDatabase(admin, name);
    const runUrl = withDatabase(slotDatabaseUrl, name);
    try {
      const migrated = Bun.spawnSync(
        ['bun', `${root}/packages/db/scripts/migrate.ts`],
        {
          cwd: root,
          env: { ...process.env, DATABASE_URL: runUrl },
          stdout: 'inherit',
          stderr: 'inherit',
        },
      );
      if (migrated.exitCode !== 0)
        throw new Error(
          `test-integration: migrating this run's database failed (exit ${migrated.exitCode})`,
        );
      return await work(runUrl);
    } finally {
      await dropTestRunDatabase(admin, name);
    }
  } finally {
    await admin.close();
  }
}
