import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { isFollowing } from './transcript-follow';

setupRitewayBun();

describe('isFollowing', () => {
  test('following the newest line until the reader scrolls up', () => {
    assert({
      given: 'a scroller at its end, just short of it, and scrolled up',
      should: 'keep following the first two and stop for the third',
      actual: [
        isFollowing({ scrollTop: 600, clientHeight: 400, scrollHeight: 1000 }),
        isFollowing({ scrollTop: 580, clientHeight: 400, scrollHeight: 1000 }),
        isFollowing({ scrollTop: 300, clientHeight: 400, scrollHeight: 1000 }),
      ],
      expected: [true, true, false],
    });
  });
});
