import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { ModeToggle } from './mode-toggle';
import { modeOptionClass, modeTrackClass } from './mode-toggle-class';

setupRitewayBun();

describe('ModeToggle', () => {
  test('three radios sharing one name, the current one checked', () => {
    const view = renderAccessible(h(ModeToggle, { value: 'ranked' }));
    const group = view.within('group', 'Ranked or casual');
    assert({
      given: 'ranked selected',
      should:
        'render Any, Ranked, Casual radios named mode with only ranked checked',
      actual: [
        group.all('radio').map((radio) => radio.getAttribute('name')),
        group.names('radio', { checked: true }),
        group.attribute('radio', 'Ranked', 'value'),
        group.names('radio'),
      ],
      expected: [
        ['mode', 'mode', 'mode'],
        ['Ranked'],
        'ranked',
        ['Any', 'Ranked', 'Casual'],
      ],
    });
  });

  test('classes', () => {
    assert({
      given: 'the toggle classes',
      should: 'track the checked state on the label',
      actual: [modeTrackClass, modeOptionClass],
      expected: [
        'flex gap-1 rounded-md bg-surface-overlay p-1 max-compact:w-full',
        'flex min-h-10 cursor-pointer items-center justify-center rounded-sm px-4 text-base font-strong text-ink-muted has-checked:bg-accent has-checked:text-accent-ink has-focus-visible:bg-accent-soft max-compact:flex-1',
      ],
    });
  });
});
