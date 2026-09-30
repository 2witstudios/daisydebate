import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import {
  claimTestRunDatabase,
  dropAllTestRunDatabases,
  sweepTestRunDatabases,
  testRunDatabaseName,
  testRunToken,
} from '../src/test-runs';

setupRitewayBun();
const { databaseUrl } = requireTestServices(process.env);

// A base outside `daisy_wt_*` and unique per file: slot pruning and other
// runs' sweeps can never select these databases, and these tests never touch
// another slot's.
const base = `daisy_probe_${createId().slice(0, 12)}_test`;
const connect = (database: string) => {
  const next = new URL(databaseUrl);
  next.pathname = `/${database}`;
  return new SQL(next.toString(), { max: 1 });
};
// CREATE/DROP DATABASE copy and remove files; under a machine full of
// parallel suites a handful of them can exceed bun's 5 s per-test default.
const ddlTimeoutMs = 30_000;
const randomToken = () =>
  testRunToken(crypto.getRandomValues(new Uint8Array(4)));

const exists = async (admin: SQL, name: string) =>
  ((await admin`select 1 from pg_database where datname = ${name}`).length ??
    0) > 0;

/**
 * Sweeps until `name` is dropped: Postgres frees a dead connection's lock
 * when its backend exits, a moment after the client closes, so the first
 * sweep can still see the runner as alive. Waits for that, not for a time.
 */
async function sweepUntilDropped(sweeper: SQL, name: string) {
  const dropped: string[] = [];
  const deadline = Date.now() + 5_000;
  do {
    dropped.push(...(await sweepTestRunDatabases(sweeper, base)));
  } while (!dropped.includes(name) && Date.now() < deadline);
  return dropped;
}

/** A runner's life in miniature: its own admin connection, its run database claimed. */
async function startRun(baseName = base) {
  const runner = connect('postgres');
  const name = testRunDatabaseName(baseName, randomToken());
  await claimTestRunDatabase(runner, name);
  return { runner, name };
}

test(
  'ISSUE-238: a sweep drops the database of a run whose runner died, and only that',
  async () => {
    const sweeper = connect('postgres');
    const live = await startRun();
    const dead = await startRun();
    const otherSlot = await startRun(`${base.replace(/_test$/, '')}_x_test`);
    try {
      // The dead run: its runner is killed, so its connection (and lock) go.
      await dead.runner.close();
      await otherSlot.runner.close();

      const dropped = await sweepUntilDropped(sweeper, dead.name);

      assert({
        given:
          'one live run, one whose runner died, and a dead run of another slot',
        should:
          'drop the dead run only: the live run holds its lock (negative control) and another slot is not this slot’s to sweep',
        actual: {
          dropped,
          live: await exists(sweeper, live.name),
          dead: await exists(sweeper, dead.name),
          otherSlot: await exists(sweeper, otherSlot.name),
        },
        expected: {
          dropped: [dead.name],
          live: true,
          dead: false,
          otherSlot: true,
        },
      });
    } finally {
      await dropAllTestRunDatabases(sweeper, base);
      await dropAllTestRunDatabases(
        sweeper,
        `${base.replace(/_test$/, '')}_x_test`,
      );
      await live.runner.close();
      await sweeper.close();
    }
  },
  ddlTimeoutMs,
);

test(
  'ISSUE-238: rows written to a killed run’s database vanish with it',
  async () => {
    const sweeper = connect('postgres');
    const run = await startRun();
    try {
      const inRun = connect(run.name);
      await inRun`create table leaked (id int)`;
      await inRun`insert into leaked select generate_series(1, 730)`;
      // The suites' own connection is still open when the runner is killed.
      await run.runner.close();

      const dropped = await sweepUntilDropped(sweeper, run.name);

      assert({
        given:
          'a database holding 730 rows and an open connection, its runner killed',
        should: 'be dropped by the next sweep, connection and rows with it',
        actual: {
          dropped,
          left: await exists(sweeper, run.name),
        },
        expected: { dropped: [run.name], left: false },
      });
      await inRun.close().catch(() => undefined);
    } finally {
      await dropAllTestRunDatabases(sweeper, base);
      await sweeper.close();
    }
  },
  ddlTimeoutMs,
);

test(
  'ISSUE-238: a claim never waits on or shares another run’s database',
  async () => {
    const admin = connect('postgres');
    const run = await startRun();
    try {
      const outcomes = [
        await claimTestRunDatabase(admin, run.name).then(
          () => 'claimed',
          (error: Error) => error.message,
        ),
      ];
      // Its runner gone, the name is free but the database is still there.
      await run.runner.close();
      // Postgres frees a dead connection's lock when its backend exits,
      // a moment after the client closes: wait for that, not for a time.
      const deadline = Date.now() + 5_000;
      let second = 'claimed';
      do {
        second = await claimTestRunDatabase(admin, run.name).then(
          () => 'claimed',
          (error: Error & { errno?: string }) => error.errno ?? error.message,
        );
      } while (second.endsWith('is already claimed') && Date.now() < deadline);
      outcomes.push(second);

      assert({
        given: 'a run database whose name is claimed, then one that exists',
        should:
          'refuse without waiting while its runner lives, and with Postgres’s duplicate-database error once it does not',
        actual: outcomes,
        expected: [`Run database ${run.name} is already claimed`, '42P04'],
      });
    } finally {
      await dropAllTestRunDatabases(admin, base);
      await run.runner.close();
      await admin.close();
    }
  },
  ddlTimeoutMs,
);
