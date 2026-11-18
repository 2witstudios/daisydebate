import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { speechPosition, speechWindow } from './speech-window';

setupRitewayBun();

describe('speechWindow', () => {
  test('the first speech of a Lincoln-Douglas round', () => {
    assert({
      given: 'seven segments with the first live',
      should: 'show it and the next, and count the other five',
      actual: speechWindow(7, 0),
      expected: { done: 0, live: 0, upcoming: [1], remaining: 5, total: 7 },
    });
  });

  test('cross-examination of the affirmative', () => {
    assert({
      given: 'seven segments with CX1 (index 1) live',
      should: 'count one done and four remaining',
      actual: speechWindow(7, 1),
      expected: { done: 1, live: 1, upcoming: [2], remaining: 4, total: 7 },
    });
  });

  test('the last speech', () => {
    assert({
      given: 'seven segments with the last live',
      should: 'show it alone after six done',
      actual: speechWindow(7, 6),
      expected: { done: 6, live: 6, upcoming: [], remaining: 0, total: 7 },
    });
  });

  test('a team round in the middle', () => {
    assert({
      given: 'twelve segments with index 5 live',
      should: 'show two chips and count the rest',
      actual: speechWindow(12, 5),
      expected: { done: 5, live: 5, upcoming: [6], remaining: 5, total: 12 },
    });
  });

  test('the largest format', () => {
    const w = speechWindow(64, 30);
    assert({
      given: 'sixty-four segments',
      should: 'still draw at most two chips, every speech accounted for',
      actual: [
        w.upcoming.length + (w.live === null ? 0 : 1) <= 2,
        w.done + (w.live === null ? 0 : 1) + w.upcoming.length + w.remaining,
      ],
      expected: [true, 64],
    });
  });

  test('before the first speech', () => {
    assert({
      given: 'a round in prep (live index -1)',
      should: 'show the first two as upcoming with nothing live',
      actual: speechWindow(7, -1),
      expected: {
        done: 0,
        live: null,
        upcoming: [0, 1],
        remaining: 5,
        total: 7,
      },
    });
  });

  test('after the last speech', () => {
    assert({
      given: 'a judging round (live index equals the segment count)',
      should: 'count every speech done',
      actual: speechWindow(7, 7),
      expected: { done: 7, live: null, upcoming: [], remaining: 0, total: 7 },
    });
  });
});

describe('speechPosition', () => {
  test('each stage of a round', () => {
    assert({
      given: 'a live speech, a round not yet started, and a finished round',
      should: 'read the position, the length, and that it is over',
      actual: [
        speechPosition(speechWindow(7, 2)),
        speechPosition(speechWindow(7, -1)),
        speechPosition(speechWindow(7, 7)),
      ],
      expected: ['3 of 7', '7 speeches', 'All done'],
    });
  });
});
