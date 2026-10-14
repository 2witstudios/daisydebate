import { assert, setupRitewayBun, test } from 'riteway/bun';
import { assertRejects } from '@daisy/errors/testing';
import { createAppendCollector } from './append-collector';
setupRitewayBun();

function collectorTimers() {
  const timers: { run: () => void; ms: number }[] = [];
  return {
    timers,
    now: () => 0,
    schedule: (run: () => void, ms: number) => {
      timers.push({ run, ms });
      return () => {};
    },
  };
}
test('append collection flushes by count and holds one executing batch per channel', async () => {
  const timing = collectorTimers();
  const { timers } = timing;
  const batches: number[][] = [];
  const releases: (() => void)[] = [];
  const collector = createAppendCollector<number, number>({
    ...timing,
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
  timers.filter(({ ms }) => ms === 5).forEach(({ run }) => run());
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

test('byte-limited batches never overflow and independent channels execute while a hot channel waits', async () => {
  const timing = collectorTimers();
  const { timers } = timing;
  const batches: { channel: string; count: number }[] = [];
  let release!: () => void;
  const collector = createAppendCollector<number, number>({
    ...timing,
    execute: async (channel, items) => {
      batches.push({ channel, count: items.length });
      if (channel === 'hot' && batches.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return items.map((value) => ({ value }));
    },
  });
  const hot = [
    collector.append('hot', 'a', 1, 70000),
    collector.append('hot', 'b', 2, 70000),
  ];
  const cold = collector.append('cold', 'c', 3, 1);
  timers.filter(({ ms }) => ms === 5).forEach(({ run }) => run());
  assert({
    given: 'two commands above the combined byte bound and another channel',
    should: 'run one bounded hot batch and let the cold channel commit',
    actual: [await cold, batches],
    expected: [
      3,
      [
        { channel: 'hot', count: 1 },
        { channel: 'cold', count: 1 },
      ],
    ],
  });
  release();
  assert({
    given: 'the hot batch settled',
    should: 'drain the remaining byte-bounded batch',
    actual: await Promise.all(hot),
    expected: [1, 2],
  });
});

test('pending work expires explicitly without releasing an executing batch', async () => {
  const timing = collectorTimers();
  const { timers } = timing;
  let release!: () => void;
  const collector = createAppendCollector<number, number>({
    ...timing,
    execute: async (_channel, items) => {
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return items.map((value) => ({ value }));
    },
  });
  const executing = collector.append('hot', 'a', 1, 1);
  timers.filter(({ ms }) => ms === 5).forEach(({ run }) => run());
  const pending = collector.append('hot', 'b', 2, 1);
  const refusal = assertRejects({
    given: 'a queued command beyond the 3s pending-age budget',
    should: 'refuse explicitly while the actual batch still occupies execution',
    actual: () => pending,
    code: 'INFRASTRUCTURE',
  });
  timers.filter(({ ms }) => ms === 3000).forEach(({ run }) => run());
  await refusal;
  release();
  assert({
    given: 'the executing batch actually settles',
    should: 'resolve its own result',
    actual: await executing,
    expected: 1,
  });
});

test('successor batches preserve every admitted command across the 32-command boundary', async () => {
  const timing = collectorTimers();
  const sizes: number[] = [];
  let release!: () => void;
  const collector = createAppendCollector<number, number>({
    ...timing,
    execute: async (_channel, commands) => {
      sizes.push(commands.length);
      if (sizes.length === 1)
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      return commands.map((value) => ({ value }));
    },
  });
  const promises = Array.from({ length: 65 }, (_, index) =>
    collector.append('channel', String(index), index, 1),
  );
  release();
  assert({
    given:
      '65 admitted commands from distinct actors while the first batch executes',
    should: 'retain all successor entries and never exceed the batch count',
    actual: [await Promise.all(promises), sizes],
    expected: [Array.from({ length: 65 }, (_, index) => index), [32, 32, 1]],
  });
});
