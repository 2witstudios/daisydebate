import { assert, setupRitewayBun, test } from 'riteway/bun';
import { reconnectDelaySeconds } from './reconnect-delay';

setupRitewayBun();

test('pages refused together spread their return above a fixed floor', () => {
  assert({
    given: 'every possible random byte',
    should: 'answer whole seconds from 2 to 4, each of them reachable',
    actual: [
      ...new Set(
        Array.from({ length: 256 }, (_, n) => reconnectDelaySeconds(n)),
      ),
    ].sort(),
    expected: [2, 3, 4],
  });
});
