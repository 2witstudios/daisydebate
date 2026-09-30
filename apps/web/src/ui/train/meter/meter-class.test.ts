import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { segmentClass } from './meter-class';

setupRitewayBun();

describe('segmentClass', () => {
  test('filled and empty', () => {
    assert({
      given: 'filled and empty segments in both tones',
      should: 'fill with the tone and leave the track neutral',
      actual: [
        segmentClass(true, 'accent'),
        segmentClass(true, 'gold'),
        segmentClass(false, 'gold'),
      ],
      expected: [
        'h-2 flex-1 rounded-round bg-accent',
        'h-2 flex-1 rounded-round bg-gold',
        'h-2 flex-1 rounded-round bg-surface-overlay',
      ],
    });
  });
});
