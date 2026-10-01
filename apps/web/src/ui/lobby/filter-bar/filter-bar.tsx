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
import {
  ClearFilters,
  FilterFooter,
  FilterSelect,
  FiltersLabel,
  SearchField,
} from '../../components/filter-form/filter-form';
import { LobbyTabs } from '../lobby-tabs/lobby-tabs';
import { ModeToggle } from '../mode-toggle/mode-toggle';
import { AutoSubmitForm } from './auto-submit-form';
import {
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
      <SearchField
        defaultValue={query.q}
        maxLength={MAX_SEARCH_LENGTH}
        placeholder="Search rooms"
        label="Search rooms or hosts"
      />
      <details className={`contents ${panelClass}`}>
        <summary className={summaryClass}>
          <FiltersLabel active={active} />
        </summary>
        <ModeToggle
          value={query.mode}
          className="order-2 max-compact:order-none"
        />
        <div className="contents max-compact:grid max-compact:grid-cols-1 max-compact:gap-3">
          <FilterSelect
            name="range"
            label="Rating range"
            value={String(query.range)}
            options={rangeOptions}
            className="order-6 max-compact:order-none"
          />
        </div>
        <ClearFilters
          href={isFiltered(query) ? clearFiltersHref(query) : null}
        />
      </details>
      <FilterFooter count={resultCount} noun="room">
        <label className="order-7 flex items-center gap-2 text-sm text-ink-faint">
          <span className="max-compact:sr-only">Sort</span>
          <FilterSelect
            name="sort"
            label="Sort by"
            value={query.sort}
            options={sortOptions}
          />
        </label>
      </FilterFooter>
    </AutoSubmitForm>
  );
}
