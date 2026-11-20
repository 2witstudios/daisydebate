import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { afterAll } from 'bun:test';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { inTransaction, type TxSource } from '../src/tx';
import { query, run } from '../src/raw-rows';
import {
  sessionLocks,
  takeLock,
  transactionLocks,
  type TransactionLock,
} from '../src/locks';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);
const holder = new SQL({ url, max: 1 });
const other = new SQL({ url, max: 1 });
const database: TxSource = drizzle({ client: holder });
afterAll(async () => {
  await holder.close();
  await other.close();
});

const numbers = z.object({ n: z.number(), at: z.date(), name: z.string() });

test('query parses every row with its schema', async () => {
  const rows = await query(
    database,
    numbers,
    sql`select n::int4 as n, now() as at, 'row ' || n as name from generate_series(1, 2) as n`,
  );
  assert({
    given: 'two rows that match the schema',
    should: 'return them parsed',
    actual: rows.map(({ n, at, name }) => [n, at instanceof Date, name]),
    expected: [
      [1, true, 'row 1'],
      [2, true, 'row 2'],
    ],
  });
});

test('query refuses a row its schema does not describe, without its values', async () => {
  const error = await query(
    database,
    z.object({ metadata: z.record(z.string(), z.number()) }),
    sql`select jsonb_build_object('person@example.com', 'private value') as metadata`,
  ).catch((caught: unknown) => caught);
  assert({
    given:
      'a user-keyed JSON object with a text value where the schema says number',
    should:
      'report the row index and issue code without the object key or value',
    actual: {
      code: (error as { code?: string }).code,
      cause: JSON.stringify((error as Error).cause),
    },
    expected: {
      code: 'INVARIANT',
      cause: JSON.stringify([{ row: 0, code: 'invalid_type' }]),
    },
  });
});

test('run executes a statement, and inTransaction commits, rolls back and nests', async () => {
  const table = sql.raw(`boundary_${process.pid}`);
  await run(database, sql`create temporary table ${table} (n int4)`);
  await inTransaction(database, (tx) =>
    run(tx, sql`insert into ${table} values (1)`),
  );
  await inTransaction(database, async (tx) => {
    await run(tx, sql`insert into ${table} values (2)`);
    throw new Error('roll back');
  }).catch(() => undefined);
  await inTransaction(database, async (tx) => {
    await run(tx, sql`insert into ${table} values (3)`);
    await inTransaction(tx, async (savepoint) => {
      await run(savepoint, sql`insert into ${table} values (4)`);
      throw new Error('roll back the savepoint');
    }).catch(() => undefined);
  });
  const rows = await query(
    database,
    z.object({ n: z.number() }),
    sql`select n from ${table} order by n`,
  );
  assert({
    given: 'a commit, a rollback, and a savepoint rolled back inside a commit',
    should: 'keep the committed rows only',
    actual: rows.map(({ n }) => n),
    expected: [1, 3],
  });
});

/** Whether another session can take `key` (the literal form a site used). */
const freeElsewhere = async (key: string, shared = false) => {
  const fn = shared
    ? 'pg_try_advisory_xact_lock_shared'
    : 'pg_try_advisory_xact_lock';
  return other.begin(async (tx) => {
    const [row]: { free: boolean }[] = await tx.unsafe(
      `select ${fn}(${key}) as free`,
    );
    return row?.free === true;
  });
};

const held = async <T>(
  lock: TransactionLock,
  probe: () => Promise<T>,
  mode: 'exclusive' | 'shared' = 'exclusive',
) =>
  inTransaction(database, async (tx) => {
    await takeLock(tx, lock, mode);
    return probe();
  });

/** Each registry lock and the statement its site took before the registry. */
const keyed: readonly (readonly [TransactionLock, string])[] = [
  [transactionLocks.roomCommand('c1'), "hashtextextended('c1', 59001)"],
  [transactionLocks.roundCommand('c1'), "hashtextextended('c1', 59002)"],
  [transactionLocks.operatorCommand('c1'), "hashtextextended('c1', 59079)"],
  [transactionLocks.tabCommand('c1'), "59002, hashtext('c1')"],
  [
    transactionLocks.betaPreapprovalEmail('a@example.com'),
    "hashtextextended('a@example.com', 59080)",
  ],
  [transactionLocks.publicProfile('a1'), "hashtextextended('a1', 71043)"],
  [transactionLocks.ratingSeat(77), '59090, 77'],
  [transactionLocks.botAdmission(), '59003, 1'],
  [transactionLocks.flags(), '59118, 1'],
  [transactionLocks.seasonCreation(), '59091, 1'],
  [transactionLocks.nonrankedCaptureCapacity(), '59081'],
  [
    transactionLocks.necessaryEvidenceCapacity(),
    "hashtextextended('necessary-evidence-capacity', 0)",
  ],
  [
    transactionLocks.roundAnalysisCapacity(),
    "hashtextextended('round-analysis-capacity', 59004)",
  ],
  [
    transactionLocks.resolutionBank(),
    "hashtextextended('resolution-bank', 59002)",
  ],
  [
    transactionLocks.tabSettingsChains(),
    "hashtextextended('tab-settings-chains', 0)",
  ],
  [
    transactionLocks.tabLobbyHandle('Ab'),
    "hashtextextended('tab-lobby-handle:ab', 0)",
  ],
  [
    transactionLocks.tabOrganizationHandle('Ab'),
    "hashtextextended('tab-organization-handle:ab', 0)",
  ],
];

test('each transaction lock holds the key its site took before the registry', async () => {
  const blocked: string[] = [];
  for (const [lock, key] of keyed)
    if (!(await held(lock, () => freeElsewhere(key)))) blocked.push(lock.name);
  const freedAfter = await Promise.all(
    keyed.map(([, key]) => freeElsewhere(key)),
  );
  assert({
    given: 'each lock taken in one transaction',
    should: 'refuse its old literal key to another session until it ends',
    actual: { blocked, freedAfter: freedAfter.every(Boolean) },
    expected: {
      blocked: keyed.map(([lock]) => lock.name),
      freedAfter: true,
    },
  });
});

test('a shared lock admits other shared holders and refuses an exclusive one', async () => {
  const flags = transactionLocks.flags();
  assert({
    given: 'the flags lock held shared',
    should: 'admit a shared holder elsewhere and refuse an exclusive one',
    actual: await held(
      flags,
      async () => [
        await freeElsewhere('59118, 1', true),
        await freeElsewhere('59118, 1'),
      ],
      'shared',
    ),
    expected: [true, false],
  });
});

test('session locks hold their old keys until released', async () => {
  const slot = "hashtext('daisy-slot-admin')";
  const tryOther = async (key: string) => {
    const [row]: { free: boolean }[] = await other.unsafe(
      `select pg_try_advisory_lock(${key}) as free`,
    );
    if (row?.free) await other.unsafe(`select pg_advisory_unlock(${key})`);
    return row?.free === true;
  };
  await sessionLocks.slotAdmin.take(holder);
  const slotHeld = await tryOther(slot);
  await sessionLocks.slotAdmin.release(holder);
  const slotFreed = await tryOther(slot);

  const runName = `daisy_boundary_${process.pid}`;
  const first = await sessionLocks.testRun.tryTake(holder, runName);
  const runKey = `hashtextextended('${runName}', 0)`;
  const second = await tryOther(runKey);
  await sessionLocks.testRun.release(holder, runName);
  const afterRelease = await tryOther(runKey);

  const mine = await holder.reserve();
  const theirs = await other.reserve();
  try {
    const elected = [
      await sessionLocks.availabilitySampler.elect(mine),
      await sessionLocks.availabilitySampler.elect(mine),
      await sessionLocks.availabilitySampler.elect(theirs),
    ];
    const samplerBlocked =
      await theirs`select pg_try_advisory_lock(59003::bigint) as free`;
    const [row]: { holds: boolean }[] =
      await mine`select ${sessionLocks.availabilitySampler.held(mine)} as holds`;
    await sessionLocks.availabilitySampler.release(mine);
    const handedOver = await sessionLocks.availabilitySampler.elect(theirs);
    await sessionLocks.availabilitySampler.release(theirs);
    assert({
      given: 'each session lock taken, contested and released',
      should: 'exclude the other session until release',
      actual: {
        slot: [slotHeld, slotFreed],
        testRun: [first, second, afterRelease],
        sampler: [...elected, samplerBlocked[0]?.free, row?.holds, handedOver],
      },
      expected: {
        slot: [false, true],
        testRun: [true, false, true],
        sampler: [true, true, false, false, true, true],
      },
    });
  } finally {
    mine.release();
    theirs.release();
  }
});
