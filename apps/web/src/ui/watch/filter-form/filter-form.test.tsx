import { createElement as h } from 'react';
import { renderToString } from 'react-dom/server';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { FilterForm, type FilterFormProps } from './filter-form';

setupRitewayBun();

const props: FilterFormProps = {
  action: '/watch',
  label: 'Filter things',
  search: { value: 'abc', label: 'Search things', placeholder: 'Search' },
  mode: 'ranked',
  sort: {
    value: 'b',
    label: 'Sort things',
    options: [
      ['a', 'A'],
      ['b', 'B'],
    ],
  },
  clearHref: '/watch',
};

describe('FilterForm', () => {
  test('a GET search form with its controls', () => {
    const html = renderToString(h(FilterForm, props));
    assert({
      given: 'a filtered form',
      should:
        'post nothing: GET to the action with search, mode, sort, Apply and Clear',
      actual: [
        /<form [^>]*action="\/watch"/.test(html),
        html.includes('method="get"'),
        html.includes('role="search"'),
        html.includes('value="abc"'),
        /<option value="b" selected=""/.test(html) || html.includes('selected'),
        html.includes('>Apply<'),
        html.includes('>Clear<'),
      ],
      expected: [true, true, true, true, true, true, true],
    });
  });

  test('no Clear when nothing is filtered', () => {
    const html = renderToString(h(FilterForm, { ...props, clearHref: null }));
    assert({
      given: 'an unfiltered form',
      should: 'omit Clear',
      actual: html.includes('>Clear<'),
      expected: false,
    });
  });
});
