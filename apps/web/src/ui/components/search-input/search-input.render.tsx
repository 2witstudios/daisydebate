import type { ReactNode } from 'react';
import { Icon } from '../icon/icon';

export type SearchInputRenderProps = {
  readonly value: string;
  readonly placeholder: string;
  readonly label: string;
  /** Void action: commits the typed query to the shell state. */
  readonly typeSearchQuery: (query: string) => void;
};

export function renderSearchInput(props: SearchInputRenderProps): ReactNode {
  const { value, placeholder, label, typeSearchQuery } = props;
  return (
    <label
      className={
        'flex max-w-search flex-1 items-center gap-2 rounded-sm border border-border bg-surface-sunken px-4 py-2 text-ink-muted transition-colors duration-120 ease-standard focus-within:border-border-strong focus-within:bg-surface hover:border-border-strong'
      }
    >
      <Icon name="search" size={16} />
      <span className="sr-only">{label}</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        className={
          'flex-1 border-none bg-transparent px-search-x py-search-y text-base text-ink outline-none placeholder:text-ink-faint'
        }
        onChange={(event) => typeSearchQuery(event.currentTarget.value)}
      />
    </label>
  );
}
