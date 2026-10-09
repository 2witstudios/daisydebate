import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { deleteExpiredOutboxPrefix } from '../src/outbox-retention';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createId } from '@paralleldrive/cuid2';
import { requireTestServices } from '@daisy/config';
import { buildRoomTopic } from '@daisy/protocol';
import {
  createDatabase,
  encodeOutboxCursor,
  type OutboxPosition,
} from '../src';
import { waitForOutboxFinality } from '../src/testing';
import { sqlStateOf } from './constraint-helpers';

setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);
const cutoff = '2001-01-01T00:00:00.000Z';
async function fixture(
  run: (f: {
    sql: SQL;
    database: ReturnType<typeof createDatabase>;
    topic: string;
    insert: (expired: boolean) => Promise<OutboxPosition>;
  }) => Promise<void>,
) {
  const sql = new SQL(url, { max: 3 });
  const database = createDatabase({ url, nextActorId: createId });
  const roomId = createId(),
    topic = buildRoomTopic(roomId);
  const original = await database.readOutboxRetentionBoundary();
  try {
    const [baseline] = await sql`select count(*)::int as count from outbox`;
    if (baseline?.count !== 0)
      throw new Error(
        'Prefix proof requires a clean isolated integration database',
      );
    if (!original)
      throw new Error('Prefix proof requires the durable boundary migration');
    await run({
      sql,
      database,
      topic,
      insert: async (expired) => {
        const [row] =
          await sql`insert into outbox(topic,kind,version,payload,created_at) values(${topic},'room.changed',1,${{ kind: 'room.changed', ids: [roomId], entityVersion: 1 }},${expired ? '2000-01-01T00:00:00.000Z' : '2002-01-01T00:00:00.000Z'}::timestamptz) returning txid::text,seq::text`;
        const position = { txid: String(row!.txid), seq: BigInt(row!.seq) };
        await waitForOutboxFinality(sql, position.txid, { now: Date.now });
        return position;
      },
    });
  } finally {
    await sql`delete from outbox where topic=${topic}`;
    // This suite's runner owns the isolated database. Restore its singleton
    // after removing only this fixture's rows; no foreign service uses it.
    if (original)
      await sql`update outbox_retention_boundary set txid=${original.txid}::xid8,seq=${original.seq.toString()}::bigint where singleton=true`;
    const closed = await Promise.allSettled([database.close(), sql.close()]);
    if (closed.some((result) => result.status === 'rejected'))
      throw new Error('Prefix proof resource cleanup failed');
  }
}
test('a locked oldest row refuses the entire prefix without deleting later history', async () => {
  await fixture(async (f) => {
    const first = await f.insert(true),
      second = await f.insert(true);
    const before = await f.database.readOutboxRetentionBoundary();
    await f.sql.begin(async (lock) => {
      await lock`select seq from outbox where seq=${first.seq.toString()}::bigint for update`;
      const refusal = await sqlStateOf(async () => {
        try {
          await f.database.purgeExpiredOutboxEvents({
            before: cutoff,
            limit: 500,
          });
        } catch (error) {
          // Drizzle preserves the actual PostgreSQL SQLSTATE in Error.cause.
          throw error instanceof Error && error.cause ? error.cause : error;
        }
      });
      const [remaining] =
        await f.sql`select count(*)::int as count from outbox where topic=${f.topic}`;
      assert({
        given: 'an older locked expired row and a later expired row',
        should: 'fail promptly without a hole or boundary advancement',
        actual: {
          refusal,
          count: remaining?.count,
          boundary: await f.database.readOutboxRetentionBoundary(),
        },
        expected: { refusal: '55P03', count: 2, boundary: before },
      });
    });
    assert({
      given: 'the predecessor lock released',
      should: 'delete the prefix and advance its durable high-water atomically',
      actual: {
        deleted: await f.database.purgeExpiredOutboxEvents({
          before: cutoff,
          limit: 500,
        }),
        boundary: await f.database.readOutboxRetentionBoundary(),
      },
      expected: { deleted: 2, boundary: second },
    });
  });
});
test('a fresh predecessor stops deletion and a stalled drain cursor cannot certify pruned rows', async () => {
  await fixture(async (f) => {
    const first = await f.insert(true),
      second = await f.insert(true),
      fresh = await f.insert(false);
    await f.insert(true);
    const deleted = await f.database.purgeExpiredOutboxEvents({
      before: cutoff,
      limit: 500,
    });
    const replay = await f.database.readOutboxCatchup(
      f.topic,
      encodeOutboxCursor(first),
      fresh,
    );
    const [remaining] =
      await f.sql`select count(*)::int as count from outbox where topic=${f.topic}`;
    assert({
      given:
        'retention overtakes cursor1 while the drain misses cursor2, then a fresh row precedes an expired row',
      should:
        'resync the stale cursor and retain the suffix behind the fresh barrier',
      actual: {
        deleted,
        remaining: remaining?.count,
        boundary: await f.database.readOutboxRetentionBoundary(),
        replay,
      },
      expected: {
        deleted: 2,
        remaining: 2,
        boundary: second,
        replay: { rows: [], resync: true },
      },
    });
    const complete = await f.database.readOutboxCatchup(
      f.topic,
      encodeOutboxCursor(second),
      fresh,
    );
    assert({
      given: 'a cursor at the certified deletion boundary',
      should: 'return the complete remaining interval',
      actual: {
        resync: complete.resync,
        positions: complete.rows.map(encodeOutboxCursor),
      },
      expected: { resync: false, positions: [encodeOutboxCursor(fresh)] },
    });
  });
});

test('concurrent history reads see deletion and its boundary in the same committed snapshot', async () => {
  await fixture(async (f) => {
    const first = await f.insert(true),
      second = await f.insert(true),
      fresh = await f.insert(false);
    await f.sql.begin(async (tx) => {
      await deleteExpiredOutboxPrefix(drizzle({ client: tx }), {
        before: cutoff,
        limit: 500,
      });
      const replay = await f.database.readOutboxCatchup(
        f.topic,
        encodeOutboxCursor(first),
        fresh,
      );
      assert({
        given: 'prefix deletion and watermark advancement are both uncommitted',
        should:
          'read the entire old interval without seeing half the transaction',
        actual: {
          resync: replay.resync,
          positions: replay.rows.map(encodeOutboxCursor),
        },
        expected: {
          resync: false,
          positions: [encodeOutboxCursor(second), encodeOutboxCursor(fresh)],
        },
      });
    });
    assert({
      given: 'the same deletion transaction committed',
      should:
        'refuse the stale cursor rather than return an incomplete interval',
      actual: await f.database.readOutboxCatchup(
        f.topic,
        encodeOutboxCursor(first),
        fresh,
      ),
      expected: { rows: [], resync: true },
    });
  });
});
test('a missing boundary refuses deletion and an empty unknown history refuses replay', async () => {
  await fixture(async (f) => {
    assert({
      given: 'an empty database with the conservative migration sentinel',
      should: 'not certify unknown pre-migration history from origin',
      actual: await f.database.readOutboxCatchup(f.topic, '0:0', {
        txid: '0',
        seq: 0n,
      }),
      expected: { rows: [], resync: true },
    });
    const first = await f.insert(true);
    await f.sql.begin(async (tx) => {
      await tx`delete from outbox_retention_boundary where singleton=true`;
      let refusal: string | null = null;
      try {
        await deleteExpiredOutboxPrefix(drizzle({ client: tx }), {
          before: cutoff,
          limit: 500,
        });
      } catch (error) {
        refusal =
          error instanceof Error ? error.message : 'Unclassified refusal';
      }
      const [remaining] =
        await tx`select count(*)::int as count from outbox where topic=${f.topic}`;
      assert({
        given: 'the singleton is unavailable in the maintenance transaction',
        should: 'refuse without deleting the retained row',
        actual: { refusal, count: remaining?.count },
        expected: {
          refusal: 'Outbox retention boundary unavailable',
          count: 1,
        },
      });
      // Restore only this test transaction's metadata before committing.
      await tx`insert into outbox_retention_boundary(singleton,txid,seq) values(true,${first.txid}::xid8,0)`;
    });
  });
});
