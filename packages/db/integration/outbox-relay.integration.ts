import { createId } from '@paralleldrive/cuid2';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { relayOutboxOperations } from '../src/outbox-relay';
import { projectionOwner } from './observation.test-support';
import { withFixture, sqlStateOf } from './constraint-helpers';
setupRitewayBun();
const { databaseUrl: url } = requireTestServices(process.env);

test('the projection role relays outbox positions and only revocation control payloads', async () => {
  await withFixture(url, async (f) => {
    const db = drizzle({ client: f.sql });
    // The relay reads through fixed functions in the projection role's own transaction.
    const relay = relayOutboxOperations({
      database: {
        execute: ((query: Parameters<typeof db.execute>[0]) =>
          projectionOwner(db).transaction((tx) =>
            tx.execute(query),
          )) as unknown as typeof db.execute,
      },
    });
    const start = await relay.readOutboxHighWaterMark();
    const actorId = createId(),
      channelId = createId();
    const inserted = await f.sql`
      insert into outbox (topic, kind, version, payload) values
        (${`user:${actorId}:inbox`}, 'session.revoked', 1, ${{ kind: 'session.revoked', entityVersion: 1, ids: [] }}),
        (${`channel:${channelId}`}, 'channel.changed', 1, ${{ kind: 'channel.changed', channelId, changeVersion: 1 }})
      returning seq`;
    try {
      const rows = await relay.drainOutbox(start, 256);
      const mine = rows.filter((row) =>
        inserted.some((r: { seq: string }) => BigInt(r.seq) === row.seq),
      );
      assert({
        given:
          'a revocation control and a content doorbell committed after the high-water mark',
        should:
          'relay both positions in commit order with only the control payload',
        actual: mine.map((row) => [row.kind, row.payload]),
        expected: [
          [
            'session.revoked',
            { kind: 'session.revoked', entityVersion: 1, ids: [] },
          ],
          ['channel.changed', null],
        ],
      });
      const next = await relay.readOutboxHighWaterMark();
      assert({
        given: 'the committed rows',
        should: 'advance the relay high-water mark past them',
        actual: next.seq >= mine.at(-1)!.seq,
        expected: true,
      });
      const asProjection = (statement: string) =>
        f.sql.begin(async (tx) => {
          await tx`set local role daisy_projection`;
          return sqlStateOf(() => tx.unsafe(statement));
        });
      const denied = await asProjection('select payload from outbox limit 1');
      const oversized = await asProjection(
        "select * from public.daisy_relay_outbox('0'::xid8, 0, 257)",
      );
      assert({
        given:
          'direct outbox reads and an oversized page under the projection role',
        should: 'refuse raw payload access and pages beyond 256 rows',
        actual: { denied, oversized },
        expected: { denied: '42501', oversized: '22023' },
      });
    } finally {
      await f.sql`delete from outbox where seq in ${f.sql(inserted.map((r: { seq: string }) => r.seq))}`;
    }
  });
});
