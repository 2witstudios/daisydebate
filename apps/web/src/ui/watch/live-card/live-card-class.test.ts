import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { modeTextClass, progressStepClass } from './live-card-class';

setupRitewayBun();

describe('live card classes', () => {
  test('progress steps', () => {
    assert({
      given: 'each step state',
      should: 'fill done, dim the current one and leave upcoming sunken',
      actual: (['done', 'current', 'upcoming'] as const).map(progressStepClass),
      expected: [
        'h-1 flex-1 rounded-round bg-accent',
        'h-1 flex-1 rounded-round bg-accent opacity-50',
        'h-1 flex-1 rounded-round bg-surface-overlay',
      ],
    });
  });

  test('mode text', () => {
    assert({
      given: 'ranked and casual',
      should: 'accent ranked and mute casual',
      actual: [modeTextClass(true), modeTextClass(false)],
      expected: ['font-strong text-accent', 'font-strong text-ink-muted'],
    });
  });
});
