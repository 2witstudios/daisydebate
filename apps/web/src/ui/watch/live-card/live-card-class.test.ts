import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { modeBorderClass, progressStepClass } from './live-card-class';

setupRitewayBun();

describe('live card classes', () => {
  test('progress steps take the debate hue', () => {
    assert({
      given: 'each step state of a ranked and a casual debate',
      should:
        'fill done, dim the current one and leave upcoming sunken, in clay for ranked and sky for casual',
      actual: [true, false].map((ranked) =>
        (['done', 'current', 'upcoming'] as const).map((step) =>
          progressStepClass(step, ranked),
        ),
      ),
      expected: [
        [
          'h-1 flex-1 rounded-round bg-hue-clay',
          'h-1 flex-1 rounded-round bg-hue-clay opacity-50',
          'h-1 flex-1 rounded-round bg-surface-overlay',
        ],
        [
          'h-1 flex-1 rounded-round bg-hue-sky',
          'h-1 flex-1 rounded-round bg-hue-sky opacity-50',
          'h-1 flex-1 rounded-round bg-surface-overlay',
        ],
      ],
    });
  });

  test('hover border', () => {
    assert({
      given: 'ranked and casual',
      should: 'use clay for ranked and sky for casual',
      actual: [modeBorderClass(true), modeBorderClass(false)],
      expected: ['hover:border-hue-clay', 'hover:border-hue-sky'],
    });
  });
});
