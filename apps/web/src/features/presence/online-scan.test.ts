import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { cachedScan } from './online-scan';

setupRitewayBun();

describe('cachedScan', () => {
  test('shares one scan inside the window and scans again after it', async () => {
    let now = 0;
    let scans = 0;
    const scan = cachedScan(
      async () => {
        scans += 1;
        return ['a'.repeat(24)];
      },
      () => now,
    );
    await Promise.all([scan(), scan()]);
    now = 999;
    await scan();
    const within = scans;
    now = 1_000;
    await scan();
    assert({
      given: 'three reads in a second, then one after it',
      should: 'scan once, then once more',
      actual: [within, scans],
      expected: [1, 2],
    });
  });

  test('a failure is not kept', async () => {
    let scans = 0;
    const scan = cachedScan(
      async () => {
        scans += 1;
        if (scans === 1) throw new Error('down');
        return [];
      },
      () => 0,
    );
    const first = await scan().catch(() => 'failed');
    await Promise.resolve();
    assert({
      given: 'a scan that failed',
      should: 'read again next time',
      actual: [first, await scan()],
      expected: ['failed', []],
    });
  });
});
