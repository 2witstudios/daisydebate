import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { createFollow, isFollowing } from './transcript-follow';

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

describe('createFollow', () => {
  const box = (scrollTop: number) => ({
    scrollTop,
    clientHeight: 100,
    scrollHeight: 1000,
  });

  test('a resize in the frame a reader scrolled up leaves them there', () => {
    const follow = createFollow();
    const reading = box(0);
    follow.scrolled(reading);
    follow.pin(reading);
    assert({
      given:
        'a reader who scrolled to the top, then a resize before any render',
      should: 'stay where they are',
      actual: reading.scrollTop,
      expected: 0,
    });
  });

  test('following pins to the newest line, and Latest resumes it', () => {
    const follow = createFollow();
    const fresh = box(0);
    follow.pin(fresh);
    const reading = box(0);
    follow.scrolled(reading);
    follow.resume();
    follow.pin(reading);
    assert({
      given: 'following from the start, and a reader who pressed Latest',
      should: 'pin both to the newest line',
      actual: [fresh.scrollTop, reading.scrollTop],
      expected: [1000, 1000],
    });
  });
});
