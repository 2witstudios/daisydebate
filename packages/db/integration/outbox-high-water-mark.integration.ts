import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readOutboxHighWaterMark } from '../src/outbox';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('the high-water mark follows the same commit-order visibility rule as the drain: an open transaction holds it back even below an already-committed later one', async () => {
  const connA = new SQL(url, { max: 1 });
  const connB = new SQL(url, { max: 1 });
  const connC = new SQL(url, { max: 1 });
  const drizzleC = drizzle({ client: connC });
  const topic = `debate:${createId()}`;
  try {
    await connA.unsafe('BEGIN');
    const [rowA] = await connA.unsafe(
      "insert into outbox (topic, kind, version, payload) values ($1, 'test.a', 1, '{}'::jsonb) returning seq, txid",
      [topic],
    );
    const positionA = { txid: BigInt(rowA.txid), seq: BigInt(rowA.seq) };

    await connB.unsafe('BEGIN');
    const [rowB] = await connB.unsafe(
      "insert into outbox (topic, kind, version, payload) values ($1, 'test.b', 1, '{}'::jsonb) returning seq, txid",
      [topic],
    );
    await connB.unsafe('COMMIT');
    const positionB = { txid: BigInt(rowB.txid), seq: BigInt(rowB.seq) };

    const whileOpen = await readOutboxHighWaterMark(drizzleC);
    const blockedByA = BigInt(whileOpen.txid) < positionA.txid;

    await connA.unsafe('COMMIT');

    const afterCommit = await readOutboxHighWaterMark(drizzleC);
    const reachesB =
      BigInt(afterCommit.txid) > positionB.txid ||
      (BigInt(afterCommit.txid) === positionB.txid &&
        afterCommit.seq >= positionB.seq);

    assert({
      given:
        'A opens and inserts, B opens, inserts and commits while A is still open, then A commits',
      should:
        'keep the high-water mark below A while A is open, even though B already committed, then advance to at least B once A commits',
      actual: { blockedByA, reachesB },
      expected: { blockedByA: true, reachesB: true },
    });
  } finally {
    await connC.unsafe('delete from outbox where topic = $1', [topic]);
    await connA.close();
    await connB.close();
    await connC.close();
  }
});
