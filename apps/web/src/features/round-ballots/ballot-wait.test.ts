import { assert, setupRitewayBun, test } from 'riteway/bun';
import { ballotWaitSince } from './ballot-refresh';

setupRitewayBun();

test('a wait is dated from the render that first showed it', () => {
  const first = ballotWaitSince(null, { state: 'settling' }, 1_000);
  const same = ballotWaitSince(first, { state: 'settling' }, 6_000);
  const next = ballotWaitSince(same, { state: 'ai_failed' }, 11_000);
  const speeches = ballotWaitSince(next, null, 16_000);
  assert({
    given:
      'a Round first seen settling, refreshed with nothing new, then seen waiting on something else, then on nothing',
    should:
      'keep the first render’s instant while the wait is the same and start over when it changes',
    actual: [first, same, next, speeches],
    expected: [
      { state: 'settling', sinceMs: 1_000 },
      { state: 'settling', sinceMs: 1_000 },
      { state: 'ai_failed', sinceMs: 11_000 },
      { state: null, sinceMs: 16_000 },
    ],
  });
});
