import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderNavItem } from './nav-item.render';

setupRitewayBun();

describe('nav-item presentation', () => {
  test('marks the active route', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/ranked',
          icon: 'swords',
          label: 'Ranked',
          active: true,
        }),
      ),
    );
    assert({
      given: 'the active route item',
      should: 'set aria-current and the active class',
      actual: [html.includes('aria-current="page"'), html.includes('/ranked')],
      expected: [true, true],
    });
  });

  test('leaves inactive items unmarked', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/watch',
          icon: 'eye',
          label: 'Watch',
          active: false,
        }),
      ),
    );
    assert({
      given: 'an inactive route item',
      should: 'omit aria-current',
      actual: html.includes('aria-current'),
      expected: false,
    });
  });

  test('names an icon-only link with screen-reader text and a tooltip', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/friends',
          icon: 'users',
          label: 'Friends, 4 online',
          title: 'Friends',
          active: false,
          badge: h('span', { 'aria-hidden': true }, '4'),
        }),
      ),
    );
    assert({
      given: 'a rail link with a count in its name and a short tooltip',
      should:
        'keep the full name readable to assistive tech (sr-only), the short label as its title, and the badge decorative',
      actual: [
        html.includes('<span class="sr-only">Friends, 4 online</span>'),
        html.includes('title="Friends"'),
        html.includes('<span aria-hidden="true">4</span>'),
      ],
      expected: [true, true, true],
    });
  });

  test('reveals sub-navigation beside the link', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/watch',
          icon: 'eye',
          label: 'Watch',
          active: false,
          subItems: [{ href: '/recordings', label: 'Recordings' }],
        }),
      ),
    );
    assert({
      given: 'a rail link with sub-items',
      should:
        'render each sub-item as a link in a flyout, tooltip defaulting to the label',
      actual: [
        html.includes('href="/recordings"'),
        html.includes('title="Watch"'),
      ],
      expected: [true, true],
    });
  });
});
