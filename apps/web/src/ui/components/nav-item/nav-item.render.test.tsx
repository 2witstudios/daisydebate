import {
  Children,
  createElement as h,
  isValidElement,
  type ReactNode,
} from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { renderNavItem } from './nav-item.render';

setupRitewayBun();

describe('nav-item presentation', () => {
  test('marks the active route', () => {
    const view = renderAccessible(
      h(renderNavItem, {
        href: '/ranked',
        icon: 'swords',
        label: 'Ranked',
        active: true,
      }),
    );
    assert({
      given: 'the active route item',
      should: 'set aria-current on the link to the route',
      actual: view.attribute('link', 'Ranked', 'href', { current: 'page' }),
      expected: '/ranked',
    });
  });

  test('leaves inactive items unmarked', () => {
    const view = renderAccessible(
      h(renderNavItem, {
        href: '/watch',
        icon: 'eye',
        label: 'Watch',
        active: false,
      }),
    );
    assert({
      given: 'an inactive route item',
      should: 'omit aria-current',
      actual: view.attribute('link', 'Watch', 'aria-current'),
      expected: null,
    });
  });

  test('names an icon-only link with screen-reader text and a tooltip', () => {
    const view = renderAccessible(
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
      given: 'a rail link with a count in its name and a short tooltip',
      should:
        'keep the full name readable to assistive tech, the short label as its title, and the badge shown but decorative',
      actual: [
        view.attribute('link', 'Friends, 4 online', 'title'),
        view.textContent(),
      ],
      expected: ['Friends', 'Friends, 4 online4'],
    });
  });

  test('reveals sub-navigation beside the link', () => {
    const view = renderAccessible(
      h(renderNavItem, {
        href: '/watch',
        icon: 'eye',
        label: 'Watch',
        active: false,
        subItems: [{ href: '/recordings', label: 'Recordings' }],
      }),
    );
    assert({
      given: 'a rail link with sub-items',
      should:
        'render each sub-item as a link in a flyout, tooltip defaulting to the label',
      actual: [
        view.attribute('link', 'Recordings', 'href'),
        view.attribute('link', 'Watch', 'title'),
      ],
      expected: ['/recordings', 'Watch'],
    });
  });

  test('extended, the label names the link and the tooltip stays', () => {
    const view = renderAccessible(
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
        'name the link by its label once, with no duplicate, and keep the tooltip for the widths where CSS hides the words',
      actual: [view.attribute('link', 'Ranked', 'title'), view.textContent()],
      expected: ['Ranked', 'Ranked'],
    });
  });

  test('mini, the accessible name stays the full label whatever word says', () => {
    const view = renderAccessible(
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
      should:
        'keep the whole name, counts included, as the link name, with the word nowhere in the output',
      actual: [view.has('link', 'Friends, 4 online'), view.textContent()],
      expected: [true, 'Friends, 4 online'],
    });
  });

  test('extended, a shortened word keeps the full label as the accessible name', () => {
    const view = renderAccessible(
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
    );
    assert({
      given: 'an extended item whose visible word is shorter than its name',
      should:
        'show the word and the badge as decoration and keep the whole name, counts included, as the link name',
      actual: [view.has('link', 'Friends, 4 online'), view.textContent()],
      expected: [true, 'FriendsFriends, 4 online4'],
    });
  });

  test('extended, sub-navigation still reveals beside the link', () => {
    const view = renderAccessible(
      h(renderNavItem, {
        href: '/watch',
        icon: 'eye',
        label: 'Watch',
        active: false,
        extended: true,
        subItems: [{ href: '/recordings', label: 'Recordings' }],
      }),
    );
    assert({
      given: 'an extended rail link with sub-items',
      should: 'render the flyout unchanged',
      actual: view.attribute('link', 'Recordings', 'href'),
      expected: '/recordings',
    });
  });
});

test('an active area keeps native navigation without speculative ancestor reads', () => {
  const links = [true, false].map((active) => {
    const item = renderNavItem({
      href: '/messages',
      icon: 'message',
      label: 'Messages',
      active,
    });
    if (!isValidElement<{ children: ReactNode }>(item))
      throw new Error('Navigation item did not render');
    const link = Children.toArray(item.props.children)[0];
    if (
      !isValidElement<{
        href: string;
        prefetch?: boolean | null;
        'aria-current'?: string;
      }>(link)
    )
      throw new Error('Navigation destination did not render');
    return [link.props.href, link.props['aria-current'], link.props.prefetch];
  });
  assert({
    given: 'the current Messages area and the same destination from elsewhere',
    should:
      'keep both native hrefs and active semantics, prefetching only the inactive destination by default',
    actual: links,
    expected: [
      ['/messages', 'page', false],
      ['/messages', undefined, null],
    ],
  });
});
