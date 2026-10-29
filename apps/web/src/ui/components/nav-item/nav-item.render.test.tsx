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

  test('opens a bottom-aligned flyout upward, so a foot item stays on screen', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/settings',
          icon: 'dots',
          label: 'More',
          active: false,
          flyoutAlign: 'bottom',
          subItems: [{ href: '/help', label: 'Help' }],
        }),
      ),
    );
    const flyout = html.slice(html.lastIndexOf('<span class="'));
    assert({
      given: 'a rail link at the foot with sub-items and a bottom flyout',
      should: 'anchor its flyout to the link’s bottom, not its top',
      actual: [/\bbottom-0\b/.test(flyout), /\btop-0\b/.test(flyout)],
      expected: [true, false],
    });
  });

  test('extended, the label shows beside the icon and the tooltip drops', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/ranked',
          icon: 'swords',
          label: 'Ranked',
          active: false,
          extended: true,
        }),
      ),
    );
    assert({
      given: 'an extended rail item',
      should:
        'render the label as text that survives every width (max-rail:sr-only), with no tooltip and no sr-only duplicate',
      actual: [
        html.includes('<span class="max-rail:sr-only">Ranked</span>'),
        html.includes('<span class="sr-only">Ranked</span>'),
        html.includes('title='),
      ],
      expected: [true, false, false],
    });
  });

  test('extended, a shortened word keeps the full label as the accessible name', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/friends',
          icon: 'users',
          label: 'Friends, 4 online',
          title: 'Friends',
          active: false,
          extended: true,
          word: 'Friends',
          badge: h('span', { 'aria-hidden': true }, '4'),
        }),
      ),
    );
    assert({
      given: 'an extended item whose visible word is shorter than its name',
      should:
        'show the word as decoration and keep the whole name, counts included, as screen-reader text',
      actual: [
        html.includes(
          '<span aria-hidden="true" class="max-rail:sr-only">Friends</span>',
        ),
        html.includes('<span class="sr-only">Friends, 4 online</span>'),
        html.includes('<span aria-hidden="true">4</span>'),
      ],
      expected: [true, true, true],
    });
  });

  test('extended, sub-navigation still reveals beside the link', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/watch',
          icon: 'eye',
          label: 'Watch',
          active: false,
          extended: true,
          subItems: [{ href: '/recordings', label: 'Recordings' }],
        }),
      ),
    );
    assert({
      given: 'an extended rail link with sub-items',
      should: 'render the flyout unchanged',
      actual: html.includes('href="/recordings"'),
      expected: true,
    });
  });
});
