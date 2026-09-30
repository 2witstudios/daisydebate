import { expect } from 'bun:test';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  claimTestRunDatabase,
  testRunLockLost,
  dropAllTestRunDatabases,
  slotDatabaseOfRun,
  sweepTestRunDatabases,
  testRunDatabaseName,
  testRunToken,
} from './test-runs';

setupRitewayBun();

describe('test run database names', () => {
  test('a token is eight hex digits of the bytes it is given', () => {
    assert({
      given: 'four bytes from the runner CSPRNG',
      should: 'name them as eight lowercase hex digits',
      actual: testRunToken(new Uint8Array([0x0a, 0x1b, 0xff, 0x00])),
      expected: '0a1bff00',
    });
    expect(() => testRunToken(new Uint8Array([1, 2, 3]))).toThrow('four bytes');
  });

  test('a run database extends the slot test database and maps back to it', () => {
    const name = testRunDatabaseName('daisy_wt_abc_test', '0a1b2c3d');

    assert({
      given: 'a slot test database and a token',
      should: 'append _run_<token>, and map back to the slot database',
      actual: [name, slotDatabaseOfRun(name)],
      expected: ['daisy_wt_abc_test_run_0a1b2c3d', 'daisy_wt_abc_test'],
    });
  });

  test('refuses anything that is not a slot test database or a token', () => {
    assert({
      given: 'a dev database, a run database as the base, and a bad token',
      should: 'refuse each and map non-run names to nothing',
      actual: [
        (() => {
          try {
            return testRunDatabaseName('daisy_wt_abc', '0a1b2c3d');
          } catch (error) {
            return String(error);
          }
        })(),
        (() => {
          try {
            return testRunDatabaseName('daisy_test', 'XYZ');
          } catch (error) {
            return String(error);
          }
        })(),
        slotDatabaseOfRun('daisy_wt_abc_test'),
        slotDatabaseOfRun('daisy_test_run_0a1b2c3'),
      ],
      expected: [
        'Error: A run database extends a slot _test database, got "daisy_wt_abc"',
        'Error: A run token is eight lowercase hex digits',
        undefined,
        undefined,
      ],
    });
  });
});

/**
 * Stands in for the admin connection only: lists the given databases, grants
 * or refuses each advisory lock by name, and records every statement.
 */
function fakeAdmin({
  databases,
  busy = [],
  connected = [],
  backendPid = 4242,
}: {
  readonly databases: readonly string[];
  readonly busy?: readonly string[];
  /** Databases another session is connected to. */
  readonly connected?: readonly string[];
  /** The backend this fake admin connection currently is. */
  readonly backendPid?: number;
}) {
  const statements: string[] = [];
  const admin = Object.assign(async () => databases.map((name) => ({ name })), {
    unsafe: async (statement: string) => {
      statements.push(statement);
      if (statement.includes('pg_backend_pid() as pid'))
        return [{ pid: backendPid }];
      const sessions = /from pg_stat_activity where datname = '([^']+)'/.exec(
        statement,
      );
      if (sessions)
        return [{ sessions: connected.includes(sessions[1] ?? '') ? 1 : 0 }];
      const lock = /pg_try_advisory_lock\(hashtextextended\('([^']+)'/.exec(
        statement,
      );
      return lock ? [{ free: !busy.includes(lock[1] ?? '') }] : [];
    },
  });
  return { admin: admin as never, statements };
}

const base = 'daisy_wt_abc_test';
const dead = `${base}_run_00000001`;
const live = `${base}_run_00000002`;

describe('claimTestRunDatabase', () => {
  test('takes the lock, then creates the database from template0', async () => {
    const { admin, statements } = fakeAdmin({ databases: [] });

    await claimTestRunDatabase(admin, dead);

    assert({
      given: 'a free run name',
      should:
        'lock before it creates (so a sweep never sees it unlocked), then note which backend holds the lock',
      actual: statements.map(
        (statement) => statement.split(' ')[0] + ' ' + statement.split(' ')[1],
      ),
      expected: [
        "select pg_try_advisory_lock(hashtextextended('daisy_wt_abc_test_run_00000001',",
        'create database',
        'select pg_backend_pid()',
      ],
    });
  });

  test('refuses a name another live runner holds, without creating', async () => {
    const { admin, statements } = fakeAdmin({ databases: [], busy: [dead] });

    await expect(claimTestRunDatabase(admin, dead)).rejects.toThrow(
      `Run database ${dead} is already claimed`,
    );
    assert({
      given: 'a name whose lock is held',
      should: 'issue no create',
      actual: statements.some((statement) => statement.startsWith('create')),
      expected: false,
    });
  });
});

describe('sweepTestRunDatabases', () => {
  test('drops the free ones, skips the held ones, releases what it took', async () => {
    const { admin, statements } = fakeAdmin({
      databases: [
        dead,
        live,
        `${base}_run_zz`,
        'daisy_wt_abc_test_run_00000003x',
      ],
      busy: [live],
    });

    const dropped = await sweepTestRunDatabases(admin, base);

    assert({
      given: 'one dead run, one live run and two names that are not runs',
      should: 'drop only the dead run, unlock it, and never touch the others',
      actual: {
        dropped,
        drops: statements.filter((statement) => statement.startsWith('drop')),
        unlocks: statements.filter((statement) =>
          statement.includes('pg_advisory_unlock'),
        ).length,
      },
      expected: {
        dropped: [dead],
        drops: [`drop database if exists "${dead}" with (force)`],
        unlocks: 1,
      },
    });
  });
});

describe('dropAllTestRunDatabases', () => {
  test('drops every run of the slot, live or not', async () => {
    const { admin, statements } = fakeAdmin({ databases: [dead, live] });

    const dropped = await dropAllTestRunDatabases(admin, base);

    assert({
      given: 'two runs',
      should: 'drop both with force and name them',
      actual: { dropped, drops: statements.length },
      expected: { dropped: [dead, live], drops: 2 },
    });
  });
});

describe('the liveness lock is tied to one session (ISSUE-250)', () => {
  test('a claim reports the backend that holds the lock', async () => {
    const { admin } = fakeAdmin({ databases: [], backendPid: 777 });

    assert({
      given: 'a claim made on backend 777',
      should: 'return 777, the session the lock lives on',
      actual: await claimTestRunDatabase(admin, dead),
      expected: 777,
    });
  });

  test('the lock is lost the moment the connection becomes another backend', async () => {
    const same = fakeAdmin({ databases: [], backendPid: 777 });
    const reconnected = fakeAdmin({ databases: [], backendPid: 778 });

    assert({
      given:
        'the claiming backend 777, seen from a connection still on 777 and from one that silently reconnected as 778',
      should: 'report the lock lost only after the reconnect',
      actual: [
        await testRunLockLost(same.admin, 777),
        await testRunLockLost(reconnected.admin, 777),
      ],
      expected: [false, true],
    });
  });
});

describe('a cut connection counts as a lost lock (ISSUE-250)', () => {
  test('a query that fails because the connection just died reports the lock lost, not an error', async () => {
    const dying = Object.assign(async () => [], {
      unsafe: async () => {
        throw new Error('Connection closed');
      },
    });

    assert({
      given: 'the first query on a connection Postgres has just terminated',
      should: 'report the lock lost instead of throwing out of the watcher',
      actual: await testRunLockLost(dying as never, 777),
      expected: true,
    });
  });
});

describe('a sweep never drops a database a session is using (ISSUE-250)', () => {
  test('skips a free-lock database that still has a connected session, and drops it once none is', async () => {
    const busyOnly = fakeAdmin({ databases: [dead], connected: [dead] });
    const idle = fakeAdmin({ databases: [dead], connected: [] });

    const whileConnected = await sweepTestRunDatabases(busyOnly.admin, base);
    const afterwards = await sweepTestRunDatabases(idle.admin, base);

    assert({
      given:
        'a run database whose lock is free (its runner’s connection was cut) but whose suites are still connected, then the same with no session',
      should:
        'leave it alone while a suite is connected (negative control: it is dropped once none is), and release the lock it took',
      actual: {
        whileConnected,
        dropsWhileConnected: busyOnly.statements.filter((statement) =>
          statement.startsWith('drop'),
        ).length,
        unlocked: busyOnly.statements.some((statement) =>
          statement.includes('pg_advisory_unlock'),
        ),
        afterwards,
      },
      expected: {
        whileConnected: [],
        dropsWhileConnected: 0,
        unlocked: true,
        afterwards: [dead],
      },
    });
  });
});
