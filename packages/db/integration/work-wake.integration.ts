import { requireTestServices } from '@daisy/config';
import { SQL } from 'bun';
import { drizzle } from 'drizzle-orm/bun-sql';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import {
  notifyWork,
  subscribeWorkWakes,
  type WorkKind,
} from '../src/work-wake';

setupRitewayBun();
requireTestServices(process.env);

test('a work wake reaches a listener on commit, at once, and never for a rollback (ADR 0154)', async () => {
  const listener = new SQL(process.env.TEST_DATABASE_URL!, { max: 1 });
  const writer = new SQL(process.env.TEST_DATABASE_URL!, { max: 1 });
  const db = drizzle({ client: writer });
  const heard: { kind: WorkKind; at: number }[] = [];
  const subscription = await subscribeWorkWakes(listener, {
    onNotify: (kind) => heard.push({ kind, at: performance.now() }),
    onListen: () => {},
  });
  const settle = async (count: number) => {
    const until = performance.now() + 2_000;
    while (heard.length < count && performance.now() < until)
      await Bun.sleep(1);
  };
  try {
    await db
      .transaction(async (tx) => {
        await notifyWork(tx, 'analysis');
        throw new Error('rolled back');
      })
      .catch(() => undefined);
    const latencies: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const before = heard.length;
      // From the command's start: its whole transaction, then delivery.
      const startedAt = performance.now();
      await db.transaction(async (tx) => {
        await notifyWork(tx, 'judging');
      });
      await settle(before + 1);
      latencies.push((heard[before]?.at ?? Infinity) - startedAt);
    }
    latencies.sort((a, b) => a - b);
    const p95 = latencies[Math.ceil(latencies.length * 0.95) - 1]!;
    assert({
      given: 'one rolled-back and twenty committed judging wakes',
      should: 'hear only the committed ones, each well inside a 250 ms scan',
      actual: {
        kinds: [...new Set(heard.map(({ kind }) => kind))],
        count: heard.length,
        fast: p95 < 100,
      },
      expected: { kinds: ['judging'], count: 20, fast: true },
    });
  } finally {
    await subscription.unlisten();
    await Promise.all([listener.close(), writer.close()]);
  }
});
