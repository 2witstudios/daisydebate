import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { purgeExpiredOutboxEvents } from '../src/outbox';
import { requireTestServices } from '@daisy/config';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

const HOUR = 3_600_000;
const now = Date.parse('2026-09-22T12:00:00.000Z');
const cutoff = new Date(now - 24 * HOUR).toISOString();

test('the retention prune deletes only rows older than the cutoff, backdated on both sides', async () => {
  const sql = new SQL(url, { max: 1 });
  const topic = `retention-${createId()}`;
  try {
    // 25h old: past the 24h cutoff, must be pruned.
    await sql.unsafe(
      "insert into outbox (topic, kind, version, payload, created_at) values ($1, 'test.old', 1, '{}'::jsonb, $2)",
      [topic, new Date(now - 25 * HOUR).toISOString()],
    );
    // 23h old: inside the retention window, must survive.
    await sql.unsafe(
      "insert into outbox (topic, kind, version, payload, created_at) values ($1, 'test.young', 1, '{}'::jsonb, $2)",
      [topic, new Date(now - 23 * HOUR).toISOString()],
    );

    const deleted = await purgeExpiredOutboxEvents(drizzle({ client: sql }), {
      before: cutoff,
      limit: 100,
    });

    const remaining = await sql.unsafe(
      'select kind from outbox where topic = $1 order by kind',
      [topic],
    );

    assert({
      given:
        'one row backdated 25h (past the 24h cutoff) and one 23h (inside it)',
      should: 'delete only the older row and leave the younger one',
      actual: {
        deleted,
        remainingKinds: remaining.map((row: { kind: string }) => row.kind),
      },
      expected: { deleted: 1, remainingKinds: ['test.young'] },
    });
  } finally {
    await sql.unsafe('delete from outbox where topic = $1', [topic]);
    await sql.close();
  }
});
