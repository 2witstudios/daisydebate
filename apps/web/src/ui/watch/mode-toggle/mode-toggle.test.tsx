import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { ModeToggle } from './mode-toggle';
import { modeOptionClass, modeTrackClass } from './mode-toggle-class';

setupRitewayBun();

describe('ModeToggle', () => {
  test('three radios sharing one name, the current one checked', () => {
    const html = renderToString(h(ModeToggle, { value: 'ranked' }));
    assert({
      given: 'ranked selected',
      should:
        'render Any, Ranked, Casual radios named mode with only ranked checked',
      actual: [
        html.match(/<input [^>]*name="mode"/g)?.length,
        /value="ranked"[^>]*checked=""|checked=""[^>]*value="ranked"/.test(
          html,
        ),
        html.match(/checked=""/g)?.length,
        ['Any', 'Ranked', 'Casual'].every((label) => html.includes(label)),
        html.includes('Rated or casual'),
      ],
      expected: [3, true, 1, true, true],
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
