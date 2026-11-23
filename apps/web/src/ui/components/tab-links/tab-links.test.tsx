import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import { TabLinks } from './tab-links';
import { tabLinkClass } from './tab-links-class';

setupRitewayBun();

describe('tabLinkClass', () => {
  test('selected and plain', () => {
    assert({
      given: 'a selected and an unselected tab',
      should: 'use the accent underline only when selected',
      actual: [
        tabLinkClass(true).includes('border-accent text-accent'),
        tabLinkClass(false).includes('border-transparent text-ink'),
      ],
      expected: [true, true],
    });
  });
});

describe('TabLinks', () => {
  test('links with the current one marked and counts shown', () => {
    const view = renderAccessible(
      h(TabLinks, {
        label: 'Status',
        tabs: [
          { id: 'a', label: 'One', href: '/x', selected: true, count: 3 },
          { id: 'b', label: 'Two', href: '/x?tab=b', selected: false },
        ],
      }),
    );
    assert({
      given: 'two tabs, the first selected with a count',
      should: 'be a labelled nav of links, marking only the first current',
      actual: [
        view.within('navigation', 'Status').names('link'),
        view.names('link', { current: 'page' }),
        view.attribute('link', 'Two', 'href'),
      ],
      expected: [['One 3', 'Two'], ['One 3'], '/x?tab=b'],
    });
  });
});
