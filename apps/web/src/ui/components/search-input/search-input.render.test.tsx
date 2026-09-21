import { renderToString } from 'react-dom/server';
import {
  Children,
  createElement as h,
  isValidElement,
  type ReactNode,
} from 'react';
import { assert, describe, setupRitewayBun, test } from 'riteway/bun';
import { renderSearchInput } from './search-input.render';
import { SearchInput } from './search-input';
import { createInitialState } from '../../store/state';
import { setUiState } from '../../store/store';

setupRitewayBun();

type ChangeHandler = (event: {
  readonly currentTarget: { readonly value: string };
}) => void;

type Inspectable = {
  readonly children?: ReactNode;
  readonly onChange?: ChangeHandler;
};

const findOnChange = (node: ReactNode): ChangeHandler | undefined => {
  if (!isValidElement<Inspectable>(node)) return undefined;
  if (node.type === 'input') return node.props.onChange;
  return Children.toArray(node.props.children)
    .map((child) => findOnChange(child))
    .find((handler) => handler !== undefined);
};

describe('renderSearchInput', () => {
  test('passes value and placeholder through to a search field', () => {
    const html = renderToString(
      h(renderSearchInput, {
        value: 'ranked',
        placeholder: 'Find a debate',
        label: 'Search debates',
        typeSearchQuery: () => {},
      }),
    );
    assert({
      given: 'a value, placeholder, and label',
      should: 'render a labelled, controlled search input',
      actual: [
        html.includes('type="search"'),
        html.includes('value="ranked"'),
        html.includes('placeholder="Find a debate"'),
        html.includes('aria-label="Search debates"'),
      ],
      expected: [true, true, true, true],
    });
  });

  test('commits what the user types', () => {
    const typed: string[] = [];
    const onChange = findOnChange(
      renderSearchInput({
        value: '',
        placeholder: 'p',
        label: 'l',
        typeSearchQuery: (query) => {
          typed.push(query);
        },
      }),
    );
    onChange?.({ currentTarget: { value: 'elo' } });
    assert({
      given: 'a change event on the input',
      should: 'call typeSearchQuery with the typed text',
      actual: typed,
      expected: ['elo'],
    });
  });
});

describe('SearchInput', () => {
  test('binds the store query with default copy', () => {
    const seed = createInitialState();
    setUiState({
      ...seed,
      resources: { ...seed.resources, searchQuery: 'climate' },
    });
    const html = renderToString(h(SearchInput, {}));
    assert({
      given: 'a store search query and no props',
      should: 'render the query with the default placeholder and label',
      actual: [
        html.includes('value="climate"'),
        html.includes('placeholder="Search users, topics, or debates…"'),
        html.includes('aria-label="Search"'),
      ],
      expected: [true, true, true],
    });
  });
});
