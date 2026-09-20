'use client';

import { useUiState } from '../../store/store';
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
  const searchQuery = useUiState((state) => state.resources.searchQuery);
  return renderSearchInput({
    value: searchQuery,
    placeholder,
    label,
    typeSearchQuery: (query) => dispatch(transactions.setSearchQuery, query),
  });
}
