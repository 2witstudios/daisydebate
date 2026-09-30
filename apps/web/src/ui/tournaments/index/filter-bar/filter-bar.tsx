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
} from '../../../components/filter-form/filter-form';
import { Icon } from '../../../components/icon/icon';
import { AutoSubmitForm } from '../../../lobby/filter-bar/auto-submit-form';
import {
  controlClass,
  dividerClass,
  filterBarClass,
  panelClass,
  summaryClass,
} from '../../../lobby/filter-bar/filter-bar-class';
import { TabLinks } from '../../tab-links/tab-links';

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

function Select(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly (readonly [string, string])[];
  readonly className: string;
}) {
  return (
    <select
      name={props.name}
      aria-label={props.label}
      defaultValue={props.value}
      className={`${controlClass} ${props.className}`}
    >
      {props.options.map(([value, label]) => (
        <option key={value} value={value}>
          {label}
        </option>
      ))}
    </select>
  );
}

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
      <label
        className={`${controlClass} order-4 flex grow basis-1/6 items-center gap-2 text-ink-muted max-compact:order-3`}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Tournament name"
          aria-label="Search tournaments"
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
        <div className="contents max-compact:grid max-compact:grid-cols-2 max-compact:gap-3">
          <Select
            name="structure"
            label="Structure"
            value={query.structure}
            options={structureOptions}
            className="order-5 max-compact:order-none"
          />
          <Select
            name="rules"
            label="Rules"
            value={query.rules}
            options={rulesOptions}
            className="order-6 max-compact:order-none"
          />
        </div>
        {isFiltered(query) ? (
          <ClearFilters href={clearFiltersHref(query)} />
        ) : null}
      </details>
      <FilterFooter
        resultLabel={`${resultCount} ${resultCount === 1 ? 'tournament' : 'tournaments'}`}
      />
    </AutoSubmitForm>
  );
}
