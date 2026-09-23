'use client';

import { useUiState, useUiStore } from '../../store/store';
import { dispatch, transactions } from '../../transactions';
import { renderSearchInput } from './search-input.render';

export type SearchInputProps = {
  readonly placeholder?: string;
  readonly label?: string;
};

export function SearchInput({
  placeholder = 'Search users, topics, or debates…',
  label = 'Search',
}: SearchInputProps) {
  const store = useUiStore();
  const searchQuery = useUiState((state) => state.resources.searchQuery);
  return renderSearchInput({
    value: searchQuery,
    placeholder,
    label,
    typeSearchQuery: (query) =>
      dispatch(store, transactions.setSearchQuery, query),
  });
}
