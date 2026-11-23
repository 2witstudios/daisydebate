import { afterMs } from '@daisy/clock';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { hostWaits } from '../src/host';

setupRitewayBun();

test('a host wait never ends before it is due, so every one-shot fires', async () => {
  const early: number[] = [];
  let fired = 0;
  await Promise.all(
    Array.from({ length: 200 }, async (_, index) => {
      const ms = 1 + (index % 7);
      const dueMs = hostWaits.nowMs() + ms;
      await hostWaits.sleep(ms);
      if (hostWaits.nowMs() < dueMs) early.push(index);
    }),
  );
  await new Promise<void>((resolve) => {
    let left = 200;
    for (let index = 0; index < 200; index += 1)
      afterMs(hostWaits, 1 + (index % 7), () => {
        fired += 1;
        left -= 1;
        if (left === 0) resolve();
      });
  });
  assert({
    given: '200 short host waits and 200 one-shots on host time',
    should: 'end none early and fire every one-shot',
    actual: { early, fired },
    expected: { early: [], fired: 200 },
  });
});
