import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createDatabase } from '../src';
import {
  OUTBOX_ORIGIN,
  appendOutboxEvent,
  decodeOutboxCursor,
  drainOutbox,
} from '../src/outbox';

setupRitewayBun();

const url = process.env.TEST_DATABASE_URL;
if (!url)
  throw new Error(
    'TEST_DATABASE_URL required; never use application database for tests',
  );
if (!new URL(url).pathname.endsWith('_test'))
  throw new Error('Test database name must end in _test');

const waitFor = async (
  check: () => boolean,
  timeoutMs = 2000,
): Promise<void> => {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs)
      throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
};

test('a committed transaction delivers its outbox row with a txid, a NOTIFY and an object payload; a rolled-back one delivers nothing', async () => {
  const database = createDatabase({ url, nextActorId: createId });
  const listener = new SQL(url);
  const reader = new SQL(url);
  const readerDb = drizzle({ client: reader });
  const topic = `debate:${createId()}`;
  const payload = { debateId: createId(), n: 1, nested: { ok: true } };
  const notifications: string[] = [];
  try {
    const subscription = await listener.listen('outbox', (received) => {
      notifications.push(received);
    });
    try {
      const committed = await database.transaction((tx) =>
        appendOutboxEvent(tx, {
          topic,
          kind: 'test.committed',
          version: 1,
          payload,
        }),
      );

      let rolledBack = false;
      try {
        await database.transaction(async (tx) => {
          await appendOutboxEvent(tx, {
            topic,
            kind: 'test.rolled-back',
            version: 1,
            payload: { ok: false },
          });
          throw new Error('deliberate rollback');
        });
      } catch {
        rolledBack = true;
      }

      await waitFor(() =>
        notifications.some((received) => {
          try {
            return decodeOutboxCursor(received).seq === committed.seq;
          } catch {
            return false;
          }
        }),
      );

      const rows = await drainOutbox(readerDb, OUTBOX_ORIGIN, 500);
      const delivered = rows.filter((row) => row.topic === topic);

      assert({
        given:
          'a committed transaction with an object payload and a rolled-back one',
        should:
          'notify, deliver exactly the committed row with a real txid and the payload round-tripped as an object (not a double-encoded string)',
        actual: {
          rolledBack,
          hasTxid: committed.txid !== '0',
          deliveredCount: delivered.length,
          kind: delivered[0]?.kind,
          seqMatches: delivered[0]?.seq === committed.seq,
          payload: delivered[0]?.payload,
          payloadIsObject: typeof delivered[0]?.payload === 'object',
        },
        expected: {
          rolledBack: true,
          hasTxid: true,
          deliveredCount: 1,
          kind: 'test.committed',
          seqMatches: true,
          payload,
          payloadIsObject: true,
        },
      });
    } finally {
      await subscription.unlisten();
    }
  } finally {
    await reader.unsafe('delete from outbox where topic = $1', [topic]);
    await listener.close();
    await reader.close();
    await database.close();
  }
});

test('two transactions that commit out of seq order never let the drain skip a row', async () => {
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

    await connB.unsafe('BEGIN');
    const [rowB] = await connB.unsafe(
      "insert into outbox (topic, kind, version, payload) values ($1, 'test.b', 1, '{}'::jsonb) returning seq, txid",
      [topic],
    );
    await connB.unsafe('COMMIT');

    // A is still open, so its txid still holds back the snapshot xmin: the
    // drain must show neither row yet, not even B's, which already committed.
    const midDrain = await drainOutbox(drizzleC, OUTBOX_ORIGIN, 500);
    const midForTopic = midDrain.filter((row) => row.topic === topic);

    await connA.unsafe('COMMIT');

    const finalDrain = await drainOutbox(drizzleC, OUTBOX_ORIGIN, 500);
    const forTopic = finalDrain.filter((row) => row.topic === topic);

    assert({
      given:
        'A opens and inserts, B opens, inserts and commits while A is still open, then A commits',
      should:
        'show neither row while A is open (even B, already committed), then both, A-lower-seq first, in (txid,seq) order',
      actual: {
        midCount: midForTopic.length,
        // Ordered by (txid, seq): A's lower seq stays first even though B
        // committed earlier in wall-clock time. Neither row is skipped.
        finalSeqs: forTopic.map((row) => row.seq),
      },
      expected: {
        midCount: 0,
        finalSeqs: [BigInt(rowA.seq), BigInt(rowB.seq)],
      },
    });
  } finally {
    await connC.unsafe('delete from outbox where topic = $1', [topic]);
    await connA.close();
    await connB.close();
    await connC.close();
  }
});
