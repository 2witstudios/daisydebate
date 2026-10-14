import { assert, setupRitewayBun, test } from 'riteway/bun';
import { createAppendCollector } from './append-collector';
setupRitewayBun();

test('append collection flushes by count and holds one executing batch per channel', async () => {
  const timers: (() => void)[] = [];
  const batches: number[][] = [];
  const releases: (() => void)[] = [];
  const collector = createAppendCollector<number, number>({
    now: () => 0,
    schedule: (run) => {
      timers.push(run);
      return () => {};
    },
    execute: async (_channel, items) => {
      batches.push([...items]);
      await new Promise<void>((resolve) => releases.push(resolve));
      return items.map((value) => ({ value }));
    },
  });
  const first = Array.from({ length: 32 }, (_, i) =>
    collector.append('channel', 'actor', i, 1),
  );
  await Promise.resolve();
  const second = collector.append('channel', 'actor', 32, 1);
  timers.forEach((run) => run());
  assert({
    given: '32 collected commands and a waiting successor',
    should: 'execute only the first full batch',
    actual: batches.map((batch) => batch.length),
    expected: [32],
  });
  releases.shift()!();
  await Promise.all(first);
  await Promise.resolve();
  assert({
    given: 'the first batch has settled',
    should: 'execute the successor only after settlement',
    actual: batches.map((batch) => batch.length),
    expected: [32, 1],
  });
  releases.shift()!();
  assert({
    given: 'a committed successor',
    should: 'resolve its committed value',
    actual: await second,
    expected: 32,
  });
});
