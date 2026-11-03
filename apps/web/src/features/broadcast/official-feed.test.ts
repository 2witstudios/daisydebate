import { assert, setupRitewayBun, test } from 'riteway/bun';
import { newFeedKey, officialFeedUrl } from './official-feed';

setupRitewayBun();

const origin = 'https://feed.daisy.invalid';

test('the official feed address is the public master playlist', () => {
  assert({
    given: 'the public origin and a feed key, with and without a final slash',
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

test('a feed key comes from the entropy it is given, in a URL-safe form', () => {
  assert({
    given: '32 injected bytes',
    should: 'encode all of them as base64url',
    actual: newFeedKey((bytes) => new Uint8Array(bytes).fill(255)),
    expected: `${'_'.repeat(42)}8`,
  });
});
