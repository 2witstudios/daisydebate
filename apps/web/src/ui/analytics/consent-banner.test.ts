import { assert, setupRitewayBun, test } from 'riteway/bun';
import { bannerSuppressedOn } from './consent-banner';

setupRitewayBun();

test('the consent banner stays out of the recorded stage', () => {
  assert({
    given: 'the Egress stage, the full-controls pages, and an ordinary page',
    should: 'suppress the banner everywhere but the ordinary page',
    actual: [
      bannerSuppressedOn('/stage/cap_123'),
      bannerSuppressedOn('/analytics'),
      bannerSuppressedOn('/settings'),
      bannerSuppressedOn('/rounds/abc/room'),
      bannerSuppressedOn('/stagecraft'),
    ],
    expected: [true, true, true, false, false],
  });
});
