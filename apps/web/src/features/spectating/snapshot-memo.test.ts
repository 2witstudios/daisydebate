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

describe('createSnapshotMemo when full', () => {
  test('evicts the oldest, so a flood cannot flush what a crowd is sharing', async () => {
    const m = setup(2);
    await m.read('crowd');
    await m.read('flood-1');
    const held = m.reads();
    await m.read('flood-2');
    await m.read('flood-1');
    assert({
      given: 'a full memo and one more key',
      should: 'drop only the oldest, and keep the newer entry',
      actual: m.reads(),
      expected: held + 1,
    });
  });

  test('evicts what has expired before anything still good', async () => {
    const m = setup(2);
    await m.read('old');
    m.tick(1000);
    await m.read('fresh');
    await m.read('new');
    const held = m.reads();
    await m.read('fresh');
    assert({
      given: 'one expired entry and one good, then a new key',
      should: 'keep the good one',
      actual: m.reads(),
      expected: held,
    });
  });
});

describe('createSnapshotMemo keeping a refusal', () => {
  test('a refusal holds for the interval, and only a refusal', async () => {
    let nowMs = 0;
    let reads = 0;
    const refused = new Error('full');
    const memo = createSnapshotMemo<number>({
      nowMs: () => nowMs,
      ttlMs: 1000,
      maxEntries: 10,
      keepsFailure: (error) => error === refused,
    });
    const ask = (key: string, failure: Error) =>
      memo(key, async () => {
        reads += 1;
        throw failure;
      }).catch((error: unknown) => error);
    const first = await ask('a', refused);
    const second = await ask('a', refused);
    assert({
      given: 'a read refused, then asked again inside the interval',
      should: 'answer the same refusal without trying again',
      actual: [first, second, reads],
      expected: [refused, refused, 1],
    });
    nowMs = 1000;
    await ask('a', refused);
    assert({
      given: 'the interval over',
      should: 'try again',
      actual: reads,
      expected: 2,
    });
    await ask('b', new Error('down'));
    await ask('b', new Error('down'));
    assert({
      given: 'any other failure',
      should: 'not keep it',
      actual: reads,
      expected: 4,
    });
  });
});
