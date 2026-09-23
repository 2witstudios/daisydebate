import { assert, setupRitewayBun, test } from 'riteway/bun';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase, type Database } from '../src';

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

setupRitewayBun();

const HOUR = 3_600_000;
const now = Date.parse('2026-09-20T12:00:00.000Z');
const cutoff = new Date(now - 24 * HOUR).toISOString();
const hoursAgo = (hours: number) => new Date(now - hours * HOUR).toISOString();

/**
 * One fixture per retained table (ISSUE-8 AC5): `insert` writes a row
 * tagged with this run's marker and timed `at`; `left` counts the tagged
 * rows still stored. Rows are tagged so concurrent suites never collide.
 */
type Table = {
  readonly operation: keyof Pick<
    Database,
    | 'purgeExpiredVerifications'
    | 'purgeExpiredOutboxEvents'
    | 'purgeExpiredEmailDeliveryEvents'
    | 'purgeExpiredEmailDeliveries'
  >;
  readonly insert: (sql: SQL, tag: string, at: string) => Promise<unknown>;
  readonly left: (sql: SQL, tag: string) => Promise<number>;
  readonly clear: (sql: SQL, tag: string) => Promise<unknown>;
};
const count = async (rows: Promise<Array<{ n: number }>>) =>
  (await rows)[0]?.n ?? 0;
const tables: readonly Table[] = [
  {
    operation: 'purgeExpiredVerifications',
    insert: (sql, tag, at) => sql`
      insert into verification (id, identifier, value, expires_at)
      values (${`${tag}-${createId()}`}, ${`hash-${tag}`}, '{}', ${at})`,
    left: (sql, tag) =>
      count(
        sql`select count(*)::int as n from verification where id like ${`${tag}-%`}`,
      ),
    clear: (sql, tag) =>
      sql`delete from verification where id like ${`${tag}-%`}`,
  },
  {
    operation: 'purgeExpiredOutboxEvents',
    insert: (sql, tag, at) => sql`
      insert into outbox (topic, kind, version, payload, created_at)
      values (${tag}, 'test.retention', 1, '{}'::jsonb, ${at})`,
    left: (sql, tag) =>
      count(sql`select count(*)::int as n from outbox where topic = ${tag}`),
    clear: (sql, tag) => sql`delete from outbox where topic = ${tag}`,
  },
  {
    operation: 'purgeExpiredEmailDeliveryEvents',
    insert: (sql, tag, at) => sql`
      insert into email_delivery_event (provider_event_id, provider_message_id, received_at)
      values (${`${tag}-${createId()}`}, ${tag}, ${at})`,
    left: (sql, tag) =>
      count(
        sql`select count(*)::int as n from email_delivery_event where provider_message_id = ${tag}`,
      ),
    clear: (sql, tag) =>
      sql`delete from email_delivery_event where provider_message_id = ${tag}`,
  },
  {
    operation: 'purgeExpiredEmailDeliveries',
    insert: (sql, tag, at) => sql`
      insert into email_delivery (id, provider_message_id, recipient_hash, status, status_rank, created_at, updated_at)
      values (${createId()}, ${`${tag}-${createId()}`}, ${tag}, 'sent', 1, ${at}, ${at})`,
    left: (sql, tag) =>
      count(
        sql`select count(*)::int as n from email_delivery where recipient_hash = ${tag}`,
      ),
    clear: (sql, tag) =>
      sql`delete from email_delivery where recipient_hash = ${tag}`,
  },
];

async function withSql<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL(url as string, { max: 1 });
  try {
    return await work(sql);
  } finally {
    await sql.close();
  }
}

test('each retained table loses only rows older than the cutoff, and a repeat run is a no-op', async () => {
  const tag = `rt-${createId().slice(0, 10)}`;
  const database = createDatabase({ url, nextActorId: createId });
  try {
    const results = [];
    for (const table of tables) {
      // 30h and 25h old: past the 24h cutoff. 23h old and 1h in the future: kept.
      await withSql(async (sql) => {
        for (const hours of [30, 25, 23, -1])
          await table.insert(sql, tag, hoursAgo(hours));
      });
      const deleted = await database[table.operation]({
        before: cutoff,
        limit: 100,
      });
      const again = await database[table.operation]({
        before: cutoff,
        limit: 100,
      });
      results.push({
        operation: table.operation,
        // Other suites' rows may also be past the cutoff; only ours are counted.
        deletedAtLeastTwo: deleted >= 2,
        repeat: again,
        left: await withSql((sql) => table.left(sql, tag)),
      });
    }
    assert({
      given:
        'rows 30h and 25h past the cutoff time, 23h old and 1h in the future, in each retained table',
      should:
        'delete the two older than the cutoff, keep the other two, and make a repeat run delete nothing',
      actual: results,
      expected: tables.map(({ operation }) => ({
        operation,
        deletedAtLeastTwo: true,
        repeat: 0,
        left: 2,
      })),
    });
  } finally {
    await database.close();
    await withSql(async (sql) => {
      for (const table of tables) await table.clear(sql, tag);
    });
  }
});

test('a batch deletes at most its limit, and an email suppression is never pruned', async () => {
  const tag = `rt-${createId().slice(0, 10)}`;
  // A cutoff in 2001 isolates these rows from any other suite's data.
  const isolatedBefore = '2001-01-02T00:00:00.000Z';
  const [deliveries] = tables.filter(
    (table) => table.operation === 'purgeExpiredEmailDeliveries',
  );
  const database = createDatabase({ url, nextActorId: createId });
  try {
    await withSql(async (sql) => {
      for (let index = 0; index < 5; index += 1)
        await deliveries!.insert(sql, tag, '2001-01-01T00:00:00.000Z');
      await sql`insert into email_suppression (recipient_hash, reason, provider_message_id, created_at)
        values (${tag}, 'bounce', ${tag}, '2001-01-01T00:00:00.000Z')`;
    });
    const deleted = await database.purgeExpiredEmailDeliveries({
      before: isolatedBefore,
      limit: 2,
    });
    const [left, suppressions] = await withSql(async (sql) => [
      await deliveries!.left(sql, tag),
      await count(
        sql`select count(*)::int as n from email_suppression where recipient_hash = ${tag}`,
      ),
    ]);
    assert({
      given:
        'five delivery rows and a suppression from 2001, and a batch limit of two',
      should:
        'delete exactly two delivery rows and keep the suppression, which outlives its deliveries',
      actual: { deleted, left, suppressions },
      expected: { deleted: 2, left: 3, suppressions: 1 },
    });
  } finally {
    await database.close();
    await withSql(async (sql) => {
      await deliveries!.clear(sql, tag);
      await sql`delete from email_suppression where recipient_hash = ${tag}`;
    });
  }
});

test('concurrent sweeps delete each expired row exactly once', async () => {
  const tag = `rt-${createId().slice(0, 10)}`;
  const [verification] = tables;
  const isolatedBefore = '2001-01-01T01:00:00.000Z';
  await withSql(async (sql) => {
    for (let index = 0; index < 40; index += 1)
      await verification!.insert(sql, tag, '2001-01-01T00:00:00.000Z');
  });
  const workers = Array.from({ length: 4 }, () =>
    createDatabase({ url, maxConnections: 2, nextActorId: createId }),
  );
  try {
    const drain = async (database: Database) => {
      let total = 0;
      for (;;) {
        const deleted = await database.purgeExpiredVerifications({
          before: isolatedBefore,
          limit: 5,
        });
        total += deleted;
        if (deleted === 0) return total;
      }
    };
    const totals = await Promise.all(workers.map(drain));
    assert({
      given:
        'forty expired rows and four sweeps draining in batches of five at once',
      should: 'delete every row and count each deletion exactly once',
      actual: {
        left: await withSql((sql) => verification!.left(sql, tag)),
        deletions: totals.reduce((sum, total) => sum + total, 0),
      },
      expected: { left: 0, deletions: 40 },
    });
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
    await withSql((sql) => verification!.clear(sql, tag));
  }
});
