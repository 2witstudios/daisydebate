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

  test('hangs off the edge it is given, and grows on hover and focus', () => {
    const left = render('left');
    const right = render('right');
    assert({
      given: 'a tab on each side',
      should:
        'sit outside its column on that side, open to the column, and widen on hover and focus',
      actual: [
        left.includes('right-full') && left.includes('border-r-0'),
        right.includes('left-full') && right.includes('border-l-0'),
        left.includes('hover:w-8') && left.includes('focus-visible:w-8'),
      ],
      expected: [true, true, true],
    });
  });
});
