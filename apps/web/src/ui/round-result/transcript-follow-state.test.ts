import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  followNext,
  initialFollow,
  isNearEnd,
  type FollowEvent,
  type FollowState,
} from './transcript-follow-state';

setupRitewayBun();

const at = (scrollTop: number, scrollHeight = 1000, clientHeight = 100) => ({
  scrollTop,
  scrollHeight,
  clientHeight,
});
const pinnedAtEnd: FollowState = { following: true, lastTop: 900 };
const reading = (lastTop: number): FollowState => ({
  following: false,
  lastTop,
});
const scrolled = (top: number, height = 1000): FollowEvent => ({
  type: 'scrolled',
  position: at(top, height),
});
const changed = (top: number, height = 1000, client = 100): FollowEvent => ({
  type: 'changed',
  position: at(top, height, client),
});

describe('isNearEnd', () => {
  test('the end of the list and a little before it', () => {
    assert({
      given: 'positions at, just inside and just outside the near-end distance',
      should: 'count only the first two',
      actual: [at(900), at(876), at(875)].map(isNearEnd),
      expected: [true, true, false],
    });
  });
});

describe('followNext', () => {
  test('a new follower starts following', () => {
    assert({
      given: 'nothing yet, and lines arriving',
      should: 'pin to the end',
      actual: followNext(initialFollow, changed(0)).pinToEnd,
      expected: true,
    });
  });

  test('a render before the scroll event leaves a reader in place', () => {
    assert({
      given: 'a move up, then a change before its scroll event',
      should: 'stop following and not pin',
      actual: followNext(pinnedAtEnd, changed(0)),
      expected: { state: reading(0), pinToEnd: false },
    });
  });

  test('a move up inside the near-end distance still counts', () => {
    assert({
      given: 'a gentle 20 px move up from the end',
      should: 'stop following, by scroll event or by a change',
      actual: [
        followNext(pinnedAtEnd, scrolled(880)),
        followNext(pinnedAtEnd, changed(880)),
      ],
      expected: [
        { state: reading(880), pinToEnd: false },
        { state: reading(880), pinToEnd: false },
      ],
    });
  });

  test('following survives what a browser does with no reader', () => {
    assert({
      given:
        'growth past the near-end distance, a fractional position from zoom, and content shrinking so the position clamps to the end',
      should: 'keep following and pin',
      actual: [
        followNext(pinnedAtEnd, scrolled(900, 1400)).state.following,
        followNext(pinnedAtEnd, changed(900, 1400)).pinToEnd,
        followNext(pinnedAtEnd, changed(899.5, 1100)).pinToEnd,
        followNext(pinnedAtEnd, changed(700, 800)).pinToEnd,
      ],
      expected: [true, true, true, true],
    });
  });

  test('reading back ends only by reaching the end, or Latest', () => {
    assert({
      given: 'a reader moving part way down, then to the near end',
      should: 'resume only at the near end',
      actual: [
        followNext(reading(0), scrolled(300)).state.following,
        followNext(reading(300), scrolled(880)).state.following,
      ],
      expected: [false, true],
    });
    assert({
      given: 'a reader near the end when layout changes',
      should: 'not resume or move them',
      actual: followNext(reading(870), changed(870, 1000)),
      expected: { state: reading(870), pinToEnd: false },
    });
  });

  test('Latest holds even when the position moved unseen', () => {
    const pressed = followNext(reading(500), { type: 'latest' });
    const written = followNext(pressed.state, { type: 'pinned', top: 900 });
    assert({
      given: 'Latest, then the write to the end it asks for',
      should: 'follow from that position, so the next change does not undo it',
      actual: [
        pressed.pinToEnd,
        written.state,
        followNext(written.state, changed(900)).pinToEnd,
      ],
      expected: [true, { following: true, lastTop: 900 }, true],
    });
  });

  test('a hidden panel returns to what the reader was doing', () => {
    const hidden = followNext(pinnedAtEnd, changed(0, 0, 0));
    assert({
      given: 'a following panel hidden, with no position to read, then shown',
      should: 'not read that as a move up, and pin on return',
      actual: [hidden, followNext(hidden.state, changed(0)).pinToEnd],
      expected: [
        { state: { following: true, lastTop: 0 }, pinToEnd: false },
        true,
      ],
    });
    const away = followNext(reading(300), changed(0, 0, 0));
    assert({
      given:
        'a panel read back to 300, hidden, then its scroll event on return',
      should: 'keep the position and keep reading',
      actual: [away.state, followNext(away.state, scrolled(300)).state],
      expected: [reading(300), reading(300)],
    });
  });
});
