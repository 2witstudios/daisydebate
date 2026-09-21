import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const HOUR = 3_600_000;
const now = Date.parse('2026-09-20T12:00:00.000Z');
const cutoff = new Date(now - 24 * HOUR).toISOString();

async function withSql<T>(work: (sql: SQL) => Promise<T>): Promise<T> {
  const sql = new SQL(url as string);
  try {
    return await work(sql);
  } finally {
    await sql.close();
  }
}

/** Rows are tagged by a unique marker so concurrent suites never collide. */
const seed = (tag: string, expiredHoursAgo: number[], at = now) =>
  withSql(async (sql) => {
    const ids: string[] = [];
    for (const hours of expiredHoursAgo) {
      const id = `${tag}-${createId()}`;
      ids.push(id);
      await sql`INSERT INTO verification (id, identifier, value, expires_at)
        VALUES (${id}, ${`hash-${id}`}, ${`{"email":"${tag}@example.test"}`},
        ${new Date(at - hours * HOUR).toISOString()})`;
    }
    return ids;
  });
const remaining = (tag: string) =>
  withSql(
    async (sql) =>
      (await sql`SELECT id FROM verification WHERE id LIKE ${`${tag}-%`}`)
        .length as number,
  );
const purgeAll = (tag: string) =>
  withSql((sql) => sql`DELETE FROM verification WHERE id LIKE ${`${tag}-%`}`);

test('only rows expired more than 24 hours ago are deleted; grace and live rows stay', async () => {
  const tag = `vp-${createId().slice(0, 8)}`;
  // 30h and 25h expired -> purge; 23h expired (grace) and -1h (still live) -> keep.
  await seed(tag, [30, 25, 23, -1]);
  const database = createDatabase({ url });
  try {
    const deleted = await database.purgeExpiredVerifications({
      before: cutoff,
      limit: 100,
    });
    const again = await database.purgeExpiredVerifications({
      before: cutoff,
      limit: 100,
    });
    expect(deleted).toBeGreaterThanOrEqual(2);
    expect(again).toBe(0);
    expect(await remaining(tag)).toBe(2);
  } finally {
    await database.close();
    await purgeAll(tag);
  }
});

test("a run deletes at most one batch and never touches this suite's user or its expired session", async () => {
  const tag = `vp-${createId().slice(0, 8)}`;
  const ids = await seed(tag, [40, 40, 40, 40, 40]);
  const userId = `${tag}-user`;
  await withSql(async (sql) => {
    await sql`INSERT INTO users (id) VALUES (${userId})`;
    // Sessions are out of this job's scope even when long expired.
    await sql`INSERT INTO session (id, expires_at, token, user_id)
      VALUES (${`${tag}-session`}, ${new Date(now - 40 * HOUR).toISOString()},
      ${`${tag}-token`}, ${userId})`;
  });
  const database = createDatabase({ url });
  try {
    const deleted = await database.purgeExpiredVerifications({
      before: cutoff,
      limit: 2,
    });
    const owned = await withSql(async (sql) => ({
      users: (await sql`SELECT id FROM users WHERE id = ${userId}`).length,
      sessions: (
        await sql`SELECT id FROM session WHERE id = ${`${tag}-session`}`
      ).length,
    }));
    expect(deleted).toBeLessThanOrEqual(2);
    expect(await remaining(tag)).toBeGreaterThanOrEqual(ids.length - 2);
    expect(owned).toEqual({ users: 1, sessions: 1 });
  } finally {
    await database.close();
    await purgeAll(tag);
    await withSql((sql) => sql`DELETE FROM users WHERE id = ${userId}`);
  }
});

test('concurrent workers delete each expired row exactly once', async () => {
  const tag = `vp-${createId().slice(0, 8)}`;
  // A cutoff in 2001 isolates these rows from any other suite's data.
  const base = Date.parse('2001-01-01T00:00:00.000Z');
  const ids = await seed(tag, Array(40).fill(0) as number[], base);
  const isolated = new Date(base + HOUR).toISOString();
  const workers = Array.from({ length: 4 }, () =>
    createDatabase({ url, maxConnections: 2 }),
  );
  try {
    const drain = async (database: (typeof workers)[number]) => {
      let total = 0;
      for (;;) {
        const deleted = await database.purgeExpiredVerifications({
          before: isolated,
          limit: 5,
        });
        total += deleted;
        if (deleted === 0) return total;
      }
    };
    const totals = await Promise.all(workers.map(drain));
    expect(await remaining(tag)).toBe(0);
    expect(totals.reduce((sum, total) => sum + total, 0)).toBe(ids.length);
  } finally {
    await Promise.all(workers.map((worker) => worker.close()));
    await purgeAll(tag);
  }
});
