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

test('a wait longer than a host timer can hold is armed in steps, never as a spin', async () => {
  const warnings: string[] = [];
  const onWarning = (warning: Error) => warnings.push(warning.name);
  process.on('warning', onWarning);
  const stop = new AbortController();
  const waiting = hostWaits.sleep(2 ** 32, stop.signal);
  const infinite = hostWaits.waitUntilMs(Infinity, stop.signal);
  await new Promise((resolve) => setTimeout(resolve, 100));
  stop.abort();
  await Promise.all([waiting, infinite]);
  process.off('warning', onWarning);
  assert({
    given: 'a 2^32 ms wait and a wait until Infinity, aborted after 100 ms',
    should: 'end on the abort without overflowing a host timer',
    actual: warnings,
    expected: [],
  });
});
