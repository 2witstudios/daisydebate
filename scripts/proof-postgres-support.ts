/**
 * What the hand-run Postgres proofs share (`bun proof:test-postgres`): the
 * slot's server, the REAL runner over real suites, and the run databases the
 * runner leaves or holds, read straight from Postgres.
 */
import { SQL } from 'bun';
import { requireTestSlotServices } from '@daisy/config';

export const root = `${import.meta.dir}/..`;
export const web = `${root}/apps/web`;
const { databaseUrl } = requireTestSlotServices(process.env);
export const slotDatabase = new URL(databaseUrl).pathname.slice(1);
export const urlOf = (database: string) => {
  const next = new URL(databaseUrl);
  next.pathname = `/${database}`;
  return next.toString();
};
export const admin = new SQL(urlOf('postgres'), { max: 1 });

export const SLOW = 'integration/auth-rate-limit-mail-ceilings.integration.ts';
export const FAST = 'integration/composition-root.integration.ts';
export const runner = (suite: string) =>
  Bun.spawn(
    [
      'bun',
      `--env-file=${root}/.env`,
      `${root}/scripts/test-integration.ts`,
      suite,
    ],
    { cwd: web, stdout: 'pipe', stderr: 'pipe' },
  );
export const textOf = async (stream: ReadableStream<Uint8Array>) =>
  await new Response(stream).text();

export async function runDatabases(): Promise<string[]> {
  const rows = (await admin`
    select datname as name from pg_database
    where starts_with(datname, ${`${slotDatabase}_run_`}) order by datname`) as Array<{
    name: string;
  }>;
  return rows.map(({ name }) => name);
}

export async function rowsIn(database: string, table: string): Promise<number> {
  const sql = new SQL(urlOf(database), { max: 1 });
  try {
    const [row] = (await sql.unsafe(
      `select count(*)::int as rows from "${table}"`,
    )) as Array<{ rows: number }>;
    return row?.rows ?? 0;
  } finally {
    await sql.close();
  }
}

export async function tableCounts(
  database: string,
): Promise<Record<string, number>> {
  const sql = new SQL(urlOf(database), { max: 1 });
  try {
    const tables = (await sql`select table_name from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
      order by table_name`) as Array<{ table_name: string }>;
    const counts: Record<string, number> = {};
    for (const { table_name: table } of tables) {
      const [row] = (await sql.unsafe(
        `select count(*)::int as rows from "${table}"`,
      )) as Array<{ rows: number }>;
      counts[table] = row?.rows ?? 0;
    }
    return counts;
  } finally {
    await sql.close();
  }
}

/**
 * Waits for a run database of the slot that is not in `known` and holds rows.
 * There is no clock: it waits for the rows, however slow the machine, and
 * fails the moment `run` (the runner just started) exits without them
 * (ISSUE-261).
 */
export async function waitForBusyRun(
  known: readonly string[],
  run: { readonly exited: Promise<number>; readonly exitCode: number | null },
): Promise<string> {
  let ended = false;
  void run.exited.then(() => (ended = true));
  while (!ended) {
    for (const name of await runDatabases())
      if (!known.includes(name)) {
        try {
          if ((await rowsIn(name, 'verification')) > 0) return name;
        } catch {
          // still migrating
        }
      }
    await Bun.sleep(250);
  }
  throw new Error(
    `the suite run ended (exit ${run.exitCode}) before it wrote a row`,
  );
}

export const descendants = (pid: number): number[] => {
  const out = Bun.spawnSync(['pgrep', '-P', String(pid)]).stdout.toString();
  return out
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .flatMap((child) => [child, ...descendants(child)]);
};

/** Whether `database` has no session besides ours. */
const sessionsOn = async (database: string): Promise<number> =>
  (
    (await admin.unsafe(
      `select count(*)::int as sessions from pg_stat_activity where datname = '${database}' and pid <> pg_backend_pid()`,
    )) as Array<{ sessions: number }>
  )[0]?.sessions ?? 0;
export { sessionsOn };

/** Waits until the dead runner's liveness lock is free (its sessions may remain). */
export async function awaitLockFree(database: string): Promise<void> {
  const key = `hashtextextended('${database}', 0)`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const [{ free }] = (await admin.unsafe(
      `select pg_try_advisory_lock(${key}) as free`,
    )) as [{ free: boolean }];
    if (free) {
      await admin.unsafe(`select pg_advisory_unlock(${key})`);
      return;
    }
    if (Date.now() > deadline) throw new Error(`${database} is still locked`);
    await Bun.sleep(100);
  }
}

/**
 * Waits, on the real condition, until a killed run's database has no session
 * left and its runner's liveness lock is free: Postgres notices a dead client
 * a moment after the process is gone, longer on a loaded machine. The next
 * run's sweep must start after that, or it rightly skips a database that
 * still looks live (ISSUE-261). Fails, never proceeds, if it does not happen.
 */
export async function awaitRunEnded(database: string): Promise<void> {
  const key = `hashtextextended('${database}', 0)`;
  const deadline = Date.now() + 120_000;
  for (;;) {
    const sessions = await sessionsOn(database);
    const [{ free }] = (await admin.unsafe(
      `select pg_try_advisory_lock(${key}) as free`,
    )) as [{ free: boolean }];
    if (free) await admin.unsafe(`select pg_advisory_unlock(${key})`);
    if (sessions === 0 && free) return;
    if (Date.now() > deadline)
      throw new Error(`${database} still has sessions or a held lock`);
    await Bun.sleep(100);
  }
}
