import { assert, setupRitewayBun, test } from 'riteway/bun';
import { challengeWhat } from './notification-words';

setupRitewayBun();

test('a challenge notification names its format, never a division (ADR 0156)', () => {
  const words = [
    challengeWhat('ranked', 'freestyle'),
    challengeWhat('casual', 'freestyle'),
  ];
  assert({
    given: 'a ranked and a casual Freestyle challenge',
    should: 'read the mode and format, with no Open or Youth',
    actual: [words, words.some((w) => /Open|Youth/.test(w))],
    expected: [
      ['a ranked Freestyle debate', 'a casual Freestyle debate'],
      false,
    ],
  });
});
