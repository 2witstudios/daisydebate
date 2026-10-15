import { assert, setupRitewayBun, test } from 'riteway/bun';
import { micBars } from './mic-level';

setupRitewayBun();

test('microphone level lights bars in proportion to signal', () => {
  assert({
    given: 'silence, a whisper, normal speech, a loud signal and clipping',
    should: 'light none through all five bars, never more',
    actual: [0, 0.01, 0.1, 0.19, 1].map(micBars),
    expected: [0, 1, 3, 5, 5],
  });
});
