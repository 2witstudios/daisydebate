import { assert, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { PremiumMark } from './premium-mark';

setupRitewayBun();

test('the Premium mark names itself only when asked', () => {
  assert({
    given: 'a label, and no label',
    should: 'be an image named by the label, or nothing a reader meets',
    actual: [
      renderAccessible(<PremiumMark label="Premium" />).has('img', 'Premium'),
      renderAccessible(<PremiumMark />).has('img', 'Premium'),
    ],
    expected: [true, false],
  });
});
