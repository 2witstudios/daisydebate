#!/usr/bin/env bun
/**
 * ISSUE-260 proof, run by `bun proof:test-postgres` after the SIGKILL proof:
 * a runner is SIGKILLed while its suite process hangs (SIGSTOP, so its
 * sessions stay open and idle for good). The run database is kept while the
 * suite could still be live, and dropped, sessions terminated, once its
 * sessions are older than the run bound. A live run side by side is never
 * dropped, however old its sessions, because its runner holds the lock.
 */
import { sweepTestRunDatabases } from '@daisy/db/test-runs';
import {
  admin,
  awaitLockFree,
  awaitSessionsOlderThan,
  cleanUpProof,
  descendants,
  runDatabases,
  runner,
  SLOW,
  sessionsOn,
  slotDatabase,
  textOf,
  track,
  waitForBusyRun,
} from './proof-postgres-support';
import { proofSteps } from './proof-support';

const HOUR_MS = 3_600_000;
// A stand-in for the run bound, small enough to wait out here.
const BOUND_MS = 3_000;
const { check, finish } = proofSteps();
const sweep = (maxRunMs: number) =>
  sweepTestRunDatabases(admin, slotDatabase, { maxRunMs });

async function main() {
  // The hung orphan: runner killed, suite stopped with its sessions open.
  const hung = runner(SLOW);
  const hungDatabase = await waitForBusyRun([], hung);
  const hungSuites = descendants(hung.pid).map(track);
  for (const pid of hungSuites) process.kill(pid, 'SIGSTOP');
  process.kill(hung.pid, 'SIGKILL');
  await hung.exited;
  await awaitLockFree(hungDatabase);
  check(
    (await sessionsOn(hungDatabase)) > 0,
    `ISSUE-260: the runner is dead (lock free) but its stopped suite still holds sessions on ${hungDatabase}`,
  );

  // A live run beside it, held mid-suite so it is long enough by construction
  // (ISSUE-270): its runner is alive and holds its lock, its suite is stopped
  // with its sessions open, however fast or slow the machine is.
  const live = runner(SLOW);
  const liveLog = textOf(live.stderr);
  const liveDatabase = await waitForBusyRun([hungDatabase], live);
  const liveSuites = descendants(live.pid).map(track);
  for (const pid of liveSuites) process.kill(pid, 'SIGSTOP');
  check(
    (await runDatabases()).includes(hungDatabase),
    'ISSUE-260: the live run’s own sweep (bound: the run length, one hour) left the orphan alone while its sessions are young',
  );
  check(
    (await sweep(HOUR_MS)).length === 0,
    'ISSUE-260 control: a sweep with the real one-hour bound keeps the orphan, whose sessions are seconds old',
  );

  // Past the bound, on the real condition (Postgres reports every session of
  // the orphan older than the bound), not a sleep.
  await awaitSessionsOlderThan(hungDatabase, BOUND_MS);
  const dropped = await sweep(BOUND_MS);
  const remaining = await runDatabases();
  check(
    dropped.length === 1 &&
      dropped[0] === hungDatabase &&
      !remaining.includes(hungDatabase),
    `ISSUE-260: once its sessions are older than the bound, the sweep terminates them and drops ${hungDatabase}`,
  );
  check(
    remaining.includes(liveDatabase) && !dropped.includes(liveDatabase),
    `ISSUE-260: the live run’s ${liveDatabase}, whose sessions are just as old, was never dropped: its runner holds the lock`,
  );

  // Let the live run finish: it carried on beside the sweep and passes.
  for (const pid of liveSuites) process.kill(pid, 'SIGCONT');
  check(
    (await live.exited) === 0 && !(await liveLog).includes('lock is gone'),
    'ISSUE-260: the live run carried on beside the sweep and passed',
  );
  for (const pid of hungSuites) process.kill(pid, 'SIGKILL');
  check(
    (await runDatabases()).length === 0,
    'ISSUE-260: no run database of the slot is left',
  );
}

try {
  await main();
} finally {
  await cleanUpProof();
}
finish();
