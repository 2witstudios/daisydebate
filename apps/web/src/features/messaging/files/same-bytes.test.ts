import { assert, setupRitewayBun, test } from 'riteway/bun';
import { sameFileBytes } from './same-bytes';
setupRitewayBun();
test('immutable upload retries compare complete normalized content', () => {
  for (const [left, right, expected] of [
    [[1, 2], [1, 2], true],
    [[1, 2], [1, 3], false],
    [[1], [1, 2], false],
  ] as const)
    assert({
      given: 'a repeated or changed upload',
      should: 'accept only equal normalized bytes',
      actual: sameFileBytes(new Uint8Array(left), new Uint8Array(right)),
      expected,
    });
});
