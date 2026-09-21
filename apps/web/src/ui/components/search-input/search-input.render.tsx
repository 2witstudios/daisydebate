import type { ReactNode } from 'react';
import { Icon } from '../icon/icon';
import styles from './search-input.module.css';

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
    <label className={styles.search}>
      <Icon name="search" size={16} />
      <span className="visually-hidden">{label}</span>
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        aria-label={label}
        className={styles.input}
        onChange={(event) => typeSearchQuery(event.currentTarget.value)}
      />
    </label>
  );
}
