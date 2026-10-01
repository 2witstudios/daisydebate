import Link from 'next/link';
import type { ReactNode } from 'react';
import type { TabCounts } from '../../../features/lobby/filter';
import {
  MAX_SEARCH_LENGTH,
  activeFilterCount,
  clearFiltersHref,
  isFiltered,
  lobbyRanges,
  lobbySorts,
  type LobbyQuery,
} from '../../../features/lobby/query';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { LobbyTabs } from '../lobby-tabs/lobby-tabs';
import { ModeToggle } from '../mode-toggle/mode-toggle';
import { AutoSubmitForm } from './auto-submit-form';
import {
  controlClass,
  dividerClass,
  filterBarClass,
  panelClass,
  summaryClass,
} from './filter-bar-class';

export type FilterBarProps = {
  readonly query: LobbyQuery;
  readonly counts: TabCounts;
  readonly resultCount: number;
};

const sortLabels: Readonly<Record<(typeof lobbySorts)[number], string>> = {
  closest: 'Closest to me',
  high: 'Highest rating',
  low: 'Lowest rating',
  waiting: 'Waiting longest',
  newest: 'Newest',
  watched: 'Most watched',
};

function Select(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly className?: string;
}): ReactNode {
  return (
    <select
      name={props.name}
      aria-label={props.label}
      defaultValue={props.value}
      className={`${controlClass} ${props.className ?? ''}`.trim()}
    >
      {props.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

const rangeOptions = lobbyRanges.map(
  (range) =>
    [
      String(range),
      range === 0 ? 'Any rating' : `Within ${range} of me`,
    ] as const,
);

const sortOptions = lobbySorts.map((sort) => [sort, sortLabels[sort]] as const);

/**
 * Tabs plus every filter as one GET form: the URL carries the state, so the
 * list filters and sorts on the server with no script. On the phone the mode
 * and range controls live in a details panel behind "Filters".
 */
export function FilterBar({ query, counts, resultCount }: FilterBarProps) {
  const active = activeFilterCount(query);
  return (
    <AutoSubmitForm
      action="/lobby"
      role="search"
      aria-label="Filter rooms"
      className={filterBarClass}
    >
      <input type="hidden" name="tab" value={query.tab} />
      <LobbyTabs
        query={query}
        counts={counts}
        className="order-1 min-w-0 flex-1 max-compact:basis-full"
      />
      <div className={dividerClass} aria-hidden="true" />
      <label
        className={`${controlClass} order-4 flex grow basis-1/6 items-center gap-2 text-ink-muted max-compact:order-3`}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Search rooms"
          aria-label="Search rooms or hosts"
          className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
        />
      </label>
      <details className={`contents ${panelClass}`}>
        <summary className={summaryClass}>
          <Icon name="dots" size={18} />
          Filters
          {active > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-round bg-accent px-2 text-xs font-bold text-accent-ink">
              {active}
            </span>
          ) : null}
        </summary>
        <ModeToggle
          value={query.mode}
          className="order-2 max-compact:order-none"
        />
        <div className="contents max-compact:grid max-compact:grid-cols-1 max-compact:gap-3">
          <Select
            name="range"
            label="Rating range"
            value={String(query.range)}
            options={rangeOptions}
            className="order-6 max-compact:order-none"
          />
        </div>
        {isFiltered(query) ? (
          <Link
            href={clearFiltersHref(query)}
            className="order-9 flex min-h-10 items-center px-1 text-base font-strong max-compact:order-none"
          >
            Clear
          </Link>
        ) : null}
      </details>
      <div className="order-7 contents max-compact:order-5 max-compact:flex max-compact:basis-full max-compact:items-center max-compact:justify-between">
        <p className="hidden text-sm whitespace-nowrap text-ink-muted max-compact:block">
          {`${resultCount} ${resultCount === 1 ? 'room' : 'rooms'}`}
        </p>
        <label className="order-7 flex items-center gap-2 text-sm text-ink-faint">
          <span className="max-compact:sr-only">Sort</span>
          <Select
            name="sort"
            label="Sort by"
            value={query.sort}
            options={sortOptions}
          />
        </label>
        <button type="submit" className={`${buttonClass('secondary')} order-8`}>
          Apply
        </button>
      </div>
    </AutoSubmitForm>
  );
}
