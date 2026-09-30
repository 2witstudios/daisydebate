#!/usr/bin/env bun
/**
 * ISSUE-238 proof, run by hand against this checkout's own slot
 * (`bun proof:test-postgres`; needs `bun slot:up`). It drives the REAL runner
 * over real suites:
 *
 *   1. A run is SIGKILLed mid-suite (runner and suite process both). Its
 *      rows are in its own run database, never in the slot's `_test`
 *      database, and the database is left behind.
 *   2. The next clean run's sweep drops it, the run passes, the row ledger
 *      is flat, and no run database of the slot remains.
 *   3. Negative controls: a run that is alive is never swept by a concurrent
 *      run (and finishes cleanly); a suite started by hand against the slot
 *      database is refused; before the sweep the killed run's database is
 *      still there (the mechanism, not luck, removes it).
 */
import { SQL } from 'bun';
import { requireTestSlotServices } from '@daisy/config';
import { proofSteps } from './proof-support';

const root = `${import.meta.dir}/..`;
const web = `${root}/apps/web`;
const { databaseUrl } = requireTestSlotServices(process.env);
const slotDatabase = new URL(databaseUrl).pathname.slice(1);
const urlOf = (database: string) => {
  const next = new URL(databaseUrl);
  next.pathname = `/${database}`;
  return next.toString();
};
const admin = new SQL(urlOf('postgres'), { max: 1 });

const SLOW = 'integration/auth-rate-limit-mail-ceilings.integration.ts';
const FAST = 'integration/composition-root.integration.ts';
const runner = (suite: string) =>
  Bun.spawn(
    [
      'bun',
      `--env-file=${root}/.env`,
      `${root}/scripts/test-integration.ts`,
      suite,
    ],
    { cwd: web, stdout: 'pipe', stderr: 'pipe' },
  );
const textOf = async (stream: ReadableStream<Uint8Array>) =>
  await new Response(stream).text();

const { check, finish } = proofSteps();

async function runDatabases(): Promise<string[]> {
  const rows = (await admin`
    select datname as name from pg_database
    where starts_with(datname, ${`${slotDatabase}_run_`}) order by datname`) as Array<{
    name: string;
  }>;
  return rows.map(({ name }) => name);
}

async function rowsIn(database: string, table: string): Promise<number> {
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

async function tableCounts(database: string): Promise<Record<string, number>> {
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

/** Waits for a run database of the slot that is not in `known` and holds rows. */
async function waitForBusyRun(known: readonly string[]): Promise<string> {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
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
  throw new Error('the slow suite never wrote a row');
}

const descendants = (pid: number): number[] => {
  const out = Bun.spawnSync(['pgrep', '-P', String(pid)]).stdout.toString();
  return out
    .split('\n')
    .filter(Boolean)
    .map(Number)
    .flatMap((child) => [child, ...descendants(child)]);
};

async function main() {
  const start = await runDatabases();
  check(start.length === 0, `no run database of ${slotDatabase} to begin with`);
  const baseBefore = await tableCounts(slotDatabase);

  // 1. Kill a real run mid-suite.
  const doomed = runner(SLOW);
  const doomedDatabase = await waitForBusyRun(start);
  const leaked = await rowsIn(doomedDatabase, 'verification');
  for (const pid of [...descendants(doomed.pid), doomed.pid])
    process.kill(pid, 'SIGKILL');
  await doomed.exited;
  await Bun.sleep(500);
  const baseAfterKill = await tableCounts(slotDatabase);
  check(
    JSON.stringify(baseAfterKill) === JSON.stringify(baseBefore),
    `AC: the ${leaked} verification rows of the SIGKILLed run are in ${doomedDatabase}, not in ${slotDatabase} (its counts are unchanged)`,
  );
  check(
    (await runDatabases()).includes(doomedDatabase),
    'AC control: before the next run the killed run’s database is still there (only the sweep removes it)',
  );

  // 3a. A run that is alive is never swept by a concurrent run.
  const alive = runner(SLOW);
  const aliveLog = textOf(alive.stderr);
  const aliveDatabase = await waitForBusyRun([doomedDatabase]);
  const concurrent = runner(FAST);
  const concurrentLog = await textOf(concurrent.stderr);
  await concurrent.exited;
  const stillThere = await runDatabases();
  check(
    concurrent.exitCode === 0 &&
      stillThere.includes(aliveDatabase) &&
      !concurrentLog.includes('dropped') &&
      !stillThere.includes(doomedDatabase),
    'AC control: a concurrent run never drops the live run’s database',
  );
  const aliveExit = await alive.exited;
  check(
    aliveExit === 0 && (await aliveLog).includes(doomedDatabase),
    'AC control: the live run swept the dead run’s database at its start, was unaffected by the concurrent run, and passed',
  );

  // 2. The next clean run: sweep, pass, ledger flat, nothing left.
  const orphan = await (async () => {
    const victim = runner(SLOW);
    const name = await waitForBusyRun([]);
    for (const pid of [...descendants(victim.pid), victim.pid])
      process.kill(pid, 'SIGKILL');
    await victim.exited;
    await Bun.sleep(500);
    return name;
  })();
  const clean = runner(FAST);
  const cleanLog = await textOf(clean.stderr);
  await clean.exited;
  check(
    clean.exitCode === 0 &&
      cleanLog.includes(orphan) &&
      !cleanLog.includes('grew from'),
    'AC: the next run sweeps the killed run’s database, passes, and its row ledger is flat',
  );
  check(
    (await runDatabases()).length === 0,
    `AC: no run database of ${slotDatabase} survives the clean run`,
  );
  check(
    JSON.stringify(await tableCounts(slotDatabase)) ===
      JSON.stringify(baseBefore),
    `AC: ${slotDatabase} holds exactly the rows it held before any of this`,
  );

  // 3b. A suite started by hand is refused.
  const byHand = Bun.spawn(
    ['bun', `--env-file=${root}/.env`, 'test', `./${FAST}`],
    { cwd: web, stdout: 'pipe', stderr: 'pipe' },
  );
  const handLog = await textOf(byHand.stderr);
  await byHand.exited;
  check(
    byHand.exitCode !== 0 && handLog.includes("must name this run's database"),
    'AC control: a suite run by hand against the slot database is refused, so it cannot leak rows',
  );

  await admin.close();
  finish();
}

await main();
