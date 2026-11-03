import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createSnapshotMemo } from './snapshot-memo';

setupRitewayBun();

const setup = (maxEntries = 10) => {
  let nowMs = 0;
  let reads = 0;
  const memo = createSnapshotMemo<number>({
    nowMs: () => nowMs,
    ttlMs: 1000,
    maxEntries,
  });
  return {
    tick: (ms: number) => (nowMs += ms),
    reads: () => reads,
    read: (key: string) =>
      memo(key, async () => {
        reads += 1;
        return reads;
      }),
    memo,
  };
};

describe('createSnapshotMemo', () => {
  test('one read per interval per key', async () => {
    const m = setup();
    await Promise.all([m.read('a'), m.read('a'), m.read('a')]);
    m.tick(999);
    await m.read('a');
    assert({
      given: 'many asks inside the interval',
      should: 'read once',
      actual: m.reads(),
      expected: 1,
    });
    m.tick(1);
    await m.read('a');
    await m.read('b');
    assert({
      given: 'an expired interval and another key',
      should: 'read again for each',
      actual: m.reads(),
      expected: 3,
    });
  });

  test('a failure is not kept', async () => {
    const m = setup();
    await m.memo('a', () => Promise.reject(new Error('down'))).catch(() => 0);
    await m.read('a');
    assert({
      given: 'a read that failed',
      should: 'read again on the next ask',
      actual: m.reads(),
      expected: 1,
    });
  });

  test('stays bounded', async () => {
    const m = setup(1);
    await m.read('a');
    await m.read('b');
    await m.read('a');
    assert({
      given: 'more keys than entries',
      should: 'forget rather than grow',
      actual: m.reads(),
      expected: 3,
    });
  });
});
