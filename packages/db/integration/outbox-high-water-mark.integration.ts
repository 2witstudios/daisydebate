import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { requireTestServices } from '@daisy/config';
import { readOutboxHighWaterMark } from '../src/outbox';
import { openOutOfOrderTransactions } from './two-transaction-race.test-support';

setupRitewayBun();

const { databaseUrl: url } = requireTestServices(process.env);

test('the high-water mark follows the same commit-order visibility rule as the drain: an open transaction holds it back even below an already-committed later one', async () => {
  const topic = `debate:${createId()}`;
  const { connA, connB, connC, drizzleC, rowA, rowB } =
    await openOutOfOrderTransactions(url, topic);
  const positionA = { txid: BigInt(rowA.txid), seq: BigInt(rowA.seq) };
  const positionB = { txid: BigInt(rowB.txid), seq: BigInt(rowB.seq) };
  try {
    const whileOpen = await readOutboxHighWaterMark(drizzleC);
    const blockedByA = BigInt(whileOpen.txid) < positionA.txid;

    await connA.unsafe('COMMIT');

    // A single read right after A's commit can still land behind another
    // suite's own open, uncommitted transaction on this shared test
    // database, since the high-water mark's whole point is to hold back for
    // ANY open transaction, not just this test's. Polling for a bounded time
    // tolerates that unrelated, transient concurrency without weakening what
    // the assertion actually proves.
    const deadline = Date.now() + 5000;
    let afterCommit = await readOutboxHighWaterMark(drizzleC);
    let reachesB =
      BigInt(afterCommit.txid) > positionB.txid ||
      (BigInt(afterCommit.txid) === positionB.txid &&
        afterCommit.seq >= positionB.seq);
    while (!reachesB && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      afterCommit = await readOutboxHighWaterMark(drizzleC);
      reachesB =
        BigInt(afterCommit.txid) > positionB.txid ||
        (BigInt(afterCommit.txid) === positionB.txid &&
          afterCommit.seq >= positionB.seq);
    }

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
