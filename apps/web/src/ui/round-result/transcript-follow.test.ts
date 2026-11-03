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
  /** A scroller as a browser keeps it: the position is clamped to the content. */
  const scroller = (scrollHeight = 1000, clientHeight = 100) => {
    let top = 0;
    return {
      clientHeight,
      scrollHeight,
      get scrollTop() {
        return top;
      },
      set scrollTop(next: number) {
        top = Math.max(
          0,
          Math.min(next, this.scrollHeight - this.clientHeight),
        );
      },
    };
  };
  const followingAtEnd = () => {
    const follow = createFollow();
    const box = scroller();
    follow.pin(box);
    return { follow, box };
  };

  test('a render or resize before the scroll event leaves a reader in place', () => {
    const { follow, box } = followingAtEnd();
    box.scrollTop = 0;
    follow.pin(box);
    assert({
      given: 'a move up, then a pin before its scroll event',
      should: 'stay where the reader went and stop following',
      actual: [box.scrollTop, follow.following()],
      expected: [0, false],
    });
    box.scrollHeight = 1200;
    follow.pin(box);
    assert({
      given: 'more lines arriving while reading back',
      should: 'still stay',
      actual: [box.scrollTop, follow.following()],
      expected: [0, false],
    });
  });

  test('following survives lines and layout growing under it', () => {
    const { follow, box } = followingAtEnd();
    box.scrollHeight = 1400;
    follow.scrolled(box);
    follow.pin(box);
    assert({
      given: 'content grown past the near-end distance, read before any pin',
      should: 'keep following and land on the newest line',
      actual: [box.scrollTop, follow.following()],
      expected: [1300, true],
    });
  });

  test('moving down keeps reading back; only the end resumes following', () => {
    const { follow, box } = followingAtEnd();
    box.scrollTop = 0;
    follow.scrolled(box);
    box.scrollTop = 300;
    follow.scrolled(box);
    const partWay = follow.following();
    box.scrollTop = 900;
    follow.scrolled(box);
    assert({
      given: 'a reader scrolling down part way, then to the end',
      should: 'resume only at the end',
      actual: [partWay, follow.following()],
      expected: [false, true],
    });
  });

  test('Latest resumes following and lands on the newest line', () => {
    const { follow, box } = followingAtEnd();
    box.scrollTop = 0;
    follow.scrolled(box);
    follow.resume();
    follow.pin(box);
    assert({
      given: 'a reader who pressed Latest',
      should: 'follow from the newest line',
      actual: [box.scrollTop, follow.following()],
      expected: [900, true],
    });
  });

  test('a hidden panel returns to where it was following or reading', () => {
    const hide = (box: { scrollHeight: number; scrollTop: number }) => {
      box.scrollHeight = 0;
      box.scrollTop = 0;
    };
    const reveal = (box: { scrollHeight: number }) => {
      box.scrollHeight = 1000;
    };
    const hidden = (box: ReturnType<typeof scroller>) => ({
      ...box,
      clientHeight: 0,
      scrollHeight: 0,
      scrollTop: 0,
    });
    const following = followingAtEnd();
    following.follow.pin(hidden(following.box));
    hide(following.box);
    reveal(following.box);
    following.follow.pin(following.box);
    const reading = followingAtEnd();
    reading.box.scrollTop = 0;
    reading.follow.scrolled(reading.box);
    reading.follow.pin(hidden(reading.box));
    reading.follow.pin(reading.box);
    assert({
      given: 'a panel hidden and shown again, following and reading back',
      should: 'land on the newest line only if it was following',
      actual: [following.box.scrollTop, reading.box.scrollTop],
      expected: [900, 0],
    });
  });

  test('listeners hear a change and nothing else', () => {
    const { follow, box } = followingAtEnd();
    let heard = 0;
    const unsubscribe = follow.subscribe(() => {
      heard += 1;
    });
    follow.pin(box);
    box.scrollTop = 0;
    follow.scrolled(box);
    unsubscribe();
    follow.resume();
    assert({
      given:
        'a pin with no change, a change, then a change after unsubscribing',
      should: 'notify once',
      actual: heard,
      expected: 1,
    });
  });
});
