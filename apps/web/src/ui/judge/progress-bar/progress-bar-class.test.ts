import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { progressFillClass, progressTrackClass } from './progress-bar-class';

setupRitewayBun();

describe('progress bar classes', () => {
  test('the track', () => {
    assert({
      given: 'the track',
      should: 'be a slim rounded bar on the overlay tone',
      actual: progressTrackClass,
      expected: 'h-2 overflow-hidden rounded-round bg-surface-overlay',
    });
  });

  test('the fill width', () => {
    assert({
      given: 'empty, 47, 45 and full, and values outside 0-100',
      should: 'round to the nearest twentieth and clamp',
      actual: [0, 47, 45, 100, -10, 130].map((percent) =>
        progressFillClass(percent, 'gold'),
      ),
      expected: [
        'h-full w-0 bg-gold',
        'h-full w-9/20 bg-gold',
        'h-full w-9/20 bg-gold',
        'h-full w-full bg-gold',
        'h-full w-0 bg-gold',
        'h-full w-full bg-gold',
      ],
    });
  });

  test('the tone', () => {
    assert({
      given: 'the accent tone',
      should: 'fill with the accent color',
      actual: progressFillClass(50, 'accent'),
      expected: 'h-full w-1/2 bg-accent',
    });
  });
});
