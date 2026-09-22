import { expect, test } from 'bun:test';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { createId } from '@paralleldrive/cuid2';
import { createDatabase } from '../src';
import {
  OUTBOX_ORIGIN,
  appendOutboxEvent,
  decodeOutboxCursor,
  drainOutbox,
} from '../src/outbox';

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

test('a committed transaction delivers its outbox row with a txid and a NOTIFY; a rolled-back one delivers nothing', async () => {
  const database = createDatabase({ url });
  const listener = new SQL(url);
  const reader = new SQL(url);
  const readerDb = drizzle({ client: reader });
  const topic = `debate:${createId()}`;
  const notifications: string[] = [];
  try {
    const subscription = await listener.listen('outbox', (payload) => {
      notifications.push(payload);
    });
    try {
      const committed = await database.transaction((tx) =>
        appendOutboxEvent(tx, {
          topic,
          kind: 'test.committed',
          version: 1,
          payload: { ok: true },
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
        notifications.some((payload) => {
          try {
            return decodeOutboxCursor(payload).seq === committed.seq;
          } catch {
            return false;
          }
        }),
      );

      const rows = await drainOutbox(readerDb, OUTBOX_ORIGIN, 500);
      const delivered = rows.filter((row) => row.topic === topic);

      expect(rolledBack).toBe(true);
      expect(committed.txid).not.toBe('0');
      expect(delivered).toHaveLength(1);
      expect(delivered[0]?.kind).toBe('test.committed');
      expect(delivered[0]?.seq).toBe(committed.seq);
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
    expect(midDrain.filter((row) => row.topic === topic)).toHaveLength(0);

    await connA.unsafe('COMMIT');

    const finalDrain = await drainOutbox(drizzleC, OUTBOX_ORIGIN, 500);
    const forTopic = finalDrain.filter((row) => row.topic === topic);
    // Ordered by (txid, seq): A's lower seq stays first even though B
    // committed earlier in wall-clock time. Neither row is skipped.
    expect(forTopic.map((row) => row.seq)).toEqual([
      BigInt(rowA.seq),
      BigInt(rowB.seq),
    ]);
  } finally {
    await connC.unsafe('delete from outbox where topic = $1', [topic]);
    await connA.close();
    await connB.close();
    await connC.close();
  }
});
