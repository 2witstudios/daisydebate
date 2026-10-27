import { operatorLimits } from '@daisy/protocol/operator';
import { assert, setupRitewayBun, test } from 'riteway/bun';
import { api, now, put } from './router.test-support';

setupRitewayBun();

test('a beta access command may commit only while its signed time is within skew (ADR 0079 §5)', async () => {
  let clock = now;
  const { handle, calls } = api({ nowMs: () => clock });
  await handle(put());
  const [input] = calls.commands as { live: () => boolean }[];
  const liveAt = (ms: number) => {
    clock = ms;
    return input?.live();
  };
  assert({
    given:
      'a PUT signed now, its commit checked at signing, at the skew bound and 1 ms past it',
    should: 'allow the commit up to the skew bound and refuse it after',
    actual: [
      liveAt(now),
      liveAt(now + operatorLimits.skewMs),
      liveAt(now + operatorLimits.skewMs + 1),
    ],
    expected: [true, true, false],
  });
});
