import { createElement as h } from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderAccessible } from '../../../test-support/rendered/accessible';
import {
  ClearFilters,
  FilterFooter,
  FilterSelect,
  FiltersLabel,
  SearchField,
} from './filter-form';

setupRitewayBun();

describe('filter form parts', () => {
  test('Clear is a link to the cleared URL', () => {
    assert({
      given: 'a clear href',
      should: 'render a Clear link',
      actual: renderAccessible(
        h(ClearFilters, { href: '/tournaments?tab=live' }),
      ).attribute('link', 'Clear', 'href'),
      expected: '/tournaments?tab=live',
    });
  });

  test('the footer shows the count, extra controls and a submit Apply', () => {
    const view = renderAccessible(
      h(FilterFooter, {
        count: 4,
        noun: 'room',
        children: h('span', null, 'extra'),
      }),
    );
    assert({
      given: 'a footer with an extra control',
      should: 'render count, extra and Apply in order',
      actual: [view.textContent(), view.attribute('button', 'Apply', 'type')],
      expected: ['4 roomsextraApply', 'submit'],
    });
  });
});

describe('filter controls', () => {
  test('a named select, a search field and the filters count', () => {
    const select = renderAccessible(
      h(FilterSelect, {
        name: 'sort',
        label: 'Sort by',
        value: 'b',
        options: [
          ['a', 'A'],
          ['b', 'B'],
        ],
      }),
    );
    const sort = [
      select.attribute('combobox', 'Sort by', 'name'),
      select.within('combobox', 'Sort by').count('option'),
    ];
    const search = renderAccessible(
      h(SearchField, {
        defaultValue: 'cup',
        maxLength: 80,
        placeholder: 'Search',
        label: 'Search things',
      }),
    ).attribute('searchbox', 'Search things', 'maxlength');
    assert({
      given: 'a select, a search field and two counts of filters',
      should: 'name the controls and show the badge only when something is set',
      actual: [
        sort,
        search,
        renderAccessible(h(FiltersLabel, { active: 2 })).textContent(),
        renderAccessible(h(FiltersLabel, { active: 0 })).textContent(),
      ],
      expected: [['sort', 2], '80', 'Filters2', 'Filters'],
    });
  });
});

describe('filter form tail details', () => {
  test('Clear renders nothing without a target, and the count pluralizes', () => {
    const clear = renderAccessible(h(ClearFilters, { href: null }));
    const nothing = [clear.count('link'), clear.textContent()];
    assert({
      given: 'no clear target and counts of one and two',
      should: 'render nothing for Clear and singular or plural nouns',
      actual: [
        nothing,
        renderAccessible(
          h(FilterFooter, { count: 1, noun: 'room' }),
        ).textContent(),
        renderAccessible(
          h(FilterFooter, { count: 2, noun: 'room' }),
        ).textContent(),
      ],
      expected: [[0, ''], '1 roomApply', '2 roomsApply'],
    });
  });
});
