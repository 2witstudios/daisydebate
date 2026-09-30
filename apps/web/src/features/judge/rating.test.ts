import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import {
  daysAgoLabel,
  decisionLabel,
  deltaLabel,
  deltaTone,
  feedbackLabel,
  formatRating,
  progressLine,
  ratingProgress,
  sparkline,
  statusLabel,
  type JudgeRating,
} from './rating';

setupRitewayBun();

const judge = (over: Partial<JudgeRating> = {}): JudgeRating => ({
  season: 'Sample season',
  status: 'provisional',
  rating: 1388,
  ballotsWithFeedback: 7,
  threshold: 15,
  series: [1350, 1388],
  recent: [],
  ...over,
});

describe('formatRating', () => {
  test('grouping', () => {
    assert({
      given: 'ratings under and over a thousand',
      should: 'group thousands with a comma',
      actual: [formatRating(1388), formatRating(980)],
      expected: ['1,388', '980'],
    });
  });
});

describe('ratingProgress and progressLine', () => {
  test('a provisional judge', () => {
    assert({
      given: '7 of 15 ballots with feedback',
      should: 'be 47 percent of the way with the count in words',
      actual: [ratingProgress(judge()), progressLine(judge())],
      expected: [47, '7 of 15 ballots with feedback to become established'],
    });
  });

  test('never past the threshold', () => {
    assert({
      given: 'more ballots than the threshold while still provisional',
      should: 'stop at 100 percent',
      actual: ratingProgress(judge({ ballotsWithFeedback: 40 })),
      expected: 100,
    });
  });

  test('an established judge', () => {
    const established = judge({ status: 'established' });
    assert({
      given: 'an established judge',
      should: 'be complete and say the rating moves more slowly',
      actual: [ratingProgress(established), progressLine(established)],
      expected: [100, 'Established. Your rating now changes more slowly.'],
    });
  });
});

describe('labels', () => {
  test('status, decision, feedback and age', () => {
    assert({
      given: 'each status, decision and a sample ballot',
      should: 'read the way the page shows them',
      actual: [
        statusLabel('provisional'),
        statusLabel('established'),
        decisionLabel('aff'),
        decisionLabel('neg'),
        decisionLabel('draw'),
        feedbackLabel({ helpful: 2, answered: 3 }),
        daysAgoLabel(0),
        daysAgoLabel(1),
        daysAgoLabel(8),
      ],
      expected: [
        'Provisional',
        'Established',
        'Aff wins',
        'Neg wins',
        'Draw',
        '2 of 3 marked helpful',
        'Today',
        '1 day ago',
        '8 days ago',
      ],
    });
  });

  test('deltas', () => {
    assert({
      given: 'a gain, a loss and no change',
      should: 'show a signed label and a tone for each',
      actual: [
        [deltaLabel(6), deltaTone(6)],
        [deltaLabel(-4), deltaTone(-4)],
        [deltaLabel(0), deltaTone(0)],
      ],
      expected: [
        ['+6', 'up'],
        ['−4', 'down'],
        ['0', 'flat'],
      ],
    });
  });
});

describe('sparkline', () => {
  const box = { width: 100, height: 50, pad: 10 };

  test('a rising series', () => {
    assert({
      given: 'three ratings rising evenly',
      should: 'run from the bottom left to the top right of the padded box',
      actual: sparkline([10, 20, 30], box),
      expected: { points: '10,40 50,25 90,10', last: { x: 90, y: 10 } },
    });
  });

  test('a flat series', () => {
    assert({
      given: 'a series that never changes',
      should: 'draw a level line through the middle',
      actual: sparkline([5, 5], box).points,
      expected: '10,25 90,25',
    });
  });

  test('one rating', () => {
    assert({
      given: 'a single rating',
      should: 'place one point and not divide by zero',
      actual: sparkline([5], box),
      expected: { points: '10,25', last: { x: 10, y: 25 } },
    });
  });
});
