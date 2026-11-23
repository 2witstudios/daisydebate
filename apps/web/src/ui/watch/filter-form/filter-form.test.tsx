import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
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
    const view = renderAccessible(h(FilterForm, props));
    const form = view.within('search', 'Filter things');
    assert({
      given: 'a filtered form',
      should:
        'post nothing: GET to the action with search, mode, sort, Apply and Clear',
      actual: [
        view.attribute('search', 'Filter things', 'action'),
        view.attribute('search', 'Filter things', 'method'),
        form.attribute('searchbox', 'Search things', 'value'),
        form
          .within('combobox', 'Sort things')
          .names('option', { selected: true }),
        form.has('button', 'Apply'),
        form.attribute('link', 'Clear', 'href'),
      ],
      expected: ['/watch', 'get', 'abc', ['B'], true, '/watch'],
    });
  });

  test('no Clear when nothing is filtered', () => {
    const view = renderAccessible(h(FilterForm, { ...props, clearHref: null }));
    assert({
      given: 'an unfiltered form',
      should: 'omit Clear',
      actual: view.has('link', 'Clear'),
      expected: false,
    });
  });
});
