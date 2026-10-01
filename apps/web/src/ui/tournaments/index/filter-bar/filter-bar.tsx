import type { TabCounts } from '../../../../features/tournaments/filter';
import {
  MAX_SEARCH_LENGTH,
  activeFilterCount,
  clearFiltersHref,
  isFiltered,
  tournamentsHref,
  type TournamentsQuery,
} from '../../../../features/tournaments/query';
import { tournamentTabs } from '../../../../features/tournaments/tournament';
import {
  ClearFilters,
  FilterFooter,
  FilterSelect,
  FiltersLabel,
  SearchField,
} from '../../../components/filter-form/filter-form';
import { AutoSubmitForm } from '../../../lobby/filter-bar/auto-submit-form';
import {
  dividerClass,
  filterBarClass,
  panelClass,
  summaryClass,
} from '../../../lobby/filter-bar/filter-bar-class';
import { TabLinks } from '../../../components/tab-links/tab-links';

export type FilterBarProps = {
  readonly query: TournamentsQuery;
  readonly counts: TabCounts;
  readonly resultCount: number;
};

const tabLabels = {
  open: 'Registration open',
  upcoming: 'Upcoming',
  live: 'In progress',
  past: 'Past',
} as const;

const structureOptions = [
  ['all', 'Any structure'],
  ['single-elimination', 'Single elimination'],
  ['round-robin', 'Round robin'],
] as const;

const rulesOptions = [
  ['all', 'Any rules'],
  ['standard', 'Standard rules'],
  ['custom', 'Custom rules'],
] as const;

/**
 * Tabs plus every filter as one GET form: the URL carries the state, so the
 * list filters on the server with no script. On the phone structure and
 * rules live in a details panel behind "Filters".
 */
export function FilterBar({ query, counts, resultCount }: FilterBarProps) {
  const active = activeFilterCount(query);
  return (
    <AutoSubmitForm
      action="/tournaments"
      role="search"
      aria-label="Filter tournaments"
      className={filterBarClass}
    >
      <input type="hidden" name="tab" value={query.tab} />
      <TabLinks
        label="Registration status"
        className="order-1 min-w-0 flex-1 max-compact:basis-full"
        tabs={tournamentTabs.map((tab) => ({
          id: tab,
          label: tabLabels[tab],
          href: tournamentsHref({ ...query, tab }),
          selected: query.tab === tab,
          count: counts[tab],
        }))}
      />
      <div className={dividerClass} aria-hidden="true" />
      <SearchField
        defaultValue={query.q}
        maxLength={MAX_SEARCH_LENGTH}
        placeholder="Tournament name"
        label="Search tournaments"
      />
      <details className={`contents ${panelClass}`}>
        <summary className={summaryClass}>
          <FiltersLabel active={active} />
        </summary>
        <div className="contents max-compact:grid max-compact:grid-cols-2 max-compact:gap-3">
          <FilterSelect
            name="structure"
            label="Structure"
            value={query.structure}
            options={structureOptions}
            className="order-5 max-compact:order-none"
          />
          <FilterSelect
            name="rules"
            label="Rules"
            value={query.rules}
            options={rulesOptions}
            className="order-6 max-compact:order-none"
          />
        </div>
        <ClearFilters
          href={isFiltered(query) ? clearFiltersHref(query) : null}
        />
      </details>
      <FilterFooter count={resultCount} noun="tournament" />
    </AutoSubmitForm>
  );
}
