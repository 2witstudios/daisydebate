import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { densityBarClass, replayPaneClass } from './replay-class';

setupRitewayBun();

describe('replay classes', () => {
  test('panes hide on the phone unless active', () => {
    assert({
      given: 'the result pane active',
      should: 'show it and hide the others on the phone',
      actual: [
        replayPaneClass('result', 'result'),
        replayPaneClass('transcript', 'result'),
        replayPaneClass('share', 'result'),
      ],
      expected: ['', 'max-compact:hidden', 'max-compact:hidden'],
    });
  });

  test('density bars grow with the level and clamp', () => {
    assert({
      given: 'levels below, inside and above range',
      should: 'map to a fixed height class',
      actual: [
        densityBarClass(-2),
        densityBarClass(0),
        densityBarClass(3),
        densityBarClass(9),
      ],
      expected: [
        'h-1 flex-1 rounded-round bg-accent-soft',
        'h-1 flex-1 rounded-round bg-accent-soft',
        'h-4 flex-1 rounded-round bg-accent-soft',
        'h-6 flex-1 rounded-round bg-accent-soft',
      ],
    });
  });
});
