import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { EdgeTab } from './edge-tab';

setupRitewayBun();

const render = (side: 'left' | 'right') =>
  renderToString(
    h(EdgeTab, {
      side,
      label: 'Collapse friends',
      expanded: true,
      icon: 'chevronRight',
      controls: 'social-rail',
      onClick: () => undefined,
    }),
  );

describe('EdgeTab', () => {
  test('a named button that says what it controls', () => {
    const html = render('left');
    assert({
      given: 'a tab for an open column',
      should:
        'be a button named for its action, expanded, controlling the column',
      actual: [
        html.startsWith('<button type="button"'),
        html.includes('aria-label="Collapse friends"'),
        html.includes('aria-expanded="true"'),
        html.includes('aria-controls="social-rail"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('sits on the seam it is given, and grows on hover and focus', () => {
    const left = render('left');
    const right = render('right');
    assert({
      given: 'a tab on each side',
      should:
        'sit centred on the seam on that side, and grow on hover and focus',
      actual: [
        left.includes('right-full') && left.includes('translate-x-1/2'),
        right.includes('left-full') && right.includes('-translate-x-1/2'),
        left.includes('group-hover:w-6') &&
          left.includes('group-focus-visible:w-6'),
      ],
      expected: [true, true, true],
    });
  });
});
