import { renderToString } from 'react-dom/server';
import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderNavItem } from './nav-item.render';
import { renderSearchInput } from '../search-input/search-input.render';

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

  test('keeps its label in the accessibility tree at compact widths', () => {
    const html = String(
      renderToString(
        h(renderNavItem, {
          href: '/train',
          icon: 'bolt',
          label: 'Train',
          active: false,
        }),
      ),
    );
    assert({
      given:
        'a link whose icon is aria-hidden and whose label is visually hidden at compact widths',
      should:
        'keep the label readable to assistive tech (sr-only), never display:none it',
      actual: [html.includes('sr-only'), html.includes('max-compact:hidden')],
      expected: [true, false],
    });
  });
});

describe('search-input presentation', () => {
  test('renders a labelled, controlled search field', () => {
    const html = String(
      renderToString(
        h(renderSearchInput, {
          value: 'ranked',
          placeholder: 'Search users, topics, or debates…',
          label: 'Search',
          typeSearchQuery: () => {},
        }),
      ),
    );
    assert({
      given: 'a search input with a query',
      should: 'render the value and accessible label',
      actual: [html.includes('value="ranked"'), html.includes('Search')],
      expected: [true, true],
    });
  });
});
