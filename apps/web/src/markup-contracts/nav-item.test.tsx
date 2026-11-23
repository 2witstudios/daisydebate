import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderMarkup } from '../test-support/rendered/markup';
import { renderNavItem } from '../ui/components/nav-item/nav-item.render';

setupRitewayBun();

/**
 * Which rail words show at which width is a responsive visibility contract
 * carried by classes alone: `sr-only` (screen-reader text at every width)
 * against `icon-rail:sr-only` (words that show until the icon-rail
 * breakpoint), and where the flyout anchors. The accessible names, titles
 * and decorative badges are asserted by role in the component test; no
 * role, name or state says whether text is visible on screen.
 */
describe('nav-item markup', () => {
  test('an icon-only link keeps its name as screen-reader text', () => {
    const html = renderMarkup(
      h(renderNavItem, {
        href: '/friends',
        icon: 'users',
        label: 'Friends, 4 online',
        title: 'Friends',
        active: false,
        badge: h('span', { 'aria-hidden': true }, '4'),
      }),
    );
    assert({
      given: 'a rail link with a count in its name',
      should: 'carry the full name as sr-only text',
      actual: html.includes('<span class="sr-only">Friends, 4 online</span>'),
      expected: true,
    });
  });

  test('opens a bottom-aligned flyout upward, so a foot item stays on screen', () => {
    const html = renderMarkup(
      h(renderNavItem, {
        href: '/settings',
        icon: 'dots',
        label: 'More',
        active: false,
        flyoutAlign: 'bottom',
        subItems: [{ href: '/help', label: 'Help' }],
      }),
    );
    const flyout = html.slice(html.lastIndexOf('<span class="'));
    assert({
      given: 'a rail link at the foot with sub-items and a bottom flyout',
      should: 'anchor its flyout to the link’s bottom, not its top',
      actual: [/\bbottom-0\b/.test(flyout), /\btop-0\b/.test(flyout)],
      expected: [true, false],
    });
  });

  test('extended, the label shows beside the icon at every width', () => {
    const html = renderMarkup(
      h(renderNavItem, {
        href: '/ranked',
        icon: 'swords',
        label: 'Ranked',
        active: false,
        extended: true,
      }),
    );
    assert({
      given: 'an extended rail item',
      should:
        'render the label as text that survives every width (icon-rail:sr-only), with no sr-only duplicate',
      actual: [
        html.includes('<span class="icon-rail:sr-only">Ranked</span>'),
        html.includes('<span class="sr-only">Ranked</span>'),
      ],
      expected: [true, false],
    });
  });

  test('mini, the full label is screen-reader text', () => {
    const html = renderMarkup(
      h(renderNavItem, {
        href: '/friends',
        icon: 'users',
        label: 'Friends, 4 online',
        title: 'Friends',
        active: false,
        word: 'Friends',
      }),
    );
    assert({
      given:
        'a minimized rail item whose visible word is shorter than its name',
      should: 'keep the whole name as sr-only text',
      actual: html.includes('<span class="sr-only">Friends, 4 online</span>'),
      expected: true,
    });
  });

  test('extended, a shortened word shows at rail widths', () => {
    const html = renderMarkup(
      h(renderNavItem, {
        href: '/friends',
        icon: 'users',
        label: 'Friends, 4 online',
        title: 'Friends',
        active: false,
        extended: true,
        word: 'Friends',
      }),
    );
    assert({
      given: 'an extended item whose visible word is shorter than its name',
      should:
        'show the word until the icon-rail breakpoint and keep the whole name as sr-only text',
      actual: [
        html.includes(
          '<span aria-hidden="true" class="icon-rail:sr-only">Friends</span>',
        ),
        html.includes('<span class="sr-only">Friends, 4 online</span>'),
      ],
      expected: [true, true],
    });
  });
});
