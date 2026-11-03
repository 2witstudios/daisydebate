import { assert, setupRitewayBun, test } from 'riteway/bun';
import { officialFeedUrl } from './official-feed';

setupRitewayBun();

const origin = 'https://public-bucket.t3.tigrisfiles.io';

test('the official feed address is the public master playlist', () => {
  assert({
    given: 'the public origin and a Broadcast, with and without a final slash',
    should: 'name the same master playlist',
    actual: [
      officialFeedUrl(origin, 'b1'),
      officialFeedUrl(`${origin}/`, 'b1'),
    ],
    expected: [
      `${origin}/live/b1/master.m3u8`,
      `${origin}/live/b1/master.m3u8`,
    ],
  });
});
