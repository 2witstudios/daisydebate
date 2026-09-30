import Link from 'next/link';
import type { ReactNode } from 'react';
import { bloomBands, bloomLabel } from '../../../features/leaderboard/bloom';
import {
  MAX_SEARCH_LENGTH,
  activeFilterCount,
  clearFiltersHref,
  isFiltered,
  scopeHref,
  type LadderQuery,
} from '../../../features/leaderboard/query';
import {
  isClosed,
  seasonLabel,
  type Season,
} from '../../../features/leaderboard/season';
import {
  PROVISIONAL_AFTER,
  regionLabel,
  regions,
} from '../../../features/leaderboard/standing';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import {
  controlClass,
  panelClass,
  summaryClass,
} from '../../lobby/filter-bar/filter-bar-class';
import { Segmented } from '../segmented/segmented';

export type LadderFiltersProps = {
  readonly query: LadderQuery;
  readonly seasons: readonly Season[];
  /** The season on screen, which the season select shows. */
  readonly season: Season;
  /** Whether the viewer has a line, which is what Around me needs. */
  readonly hasStanding: boolean;
};

type Option = { readonly value: string; readonly label: string };

const option = (value: string, label: string): Option => ({ value, label });

type SelectProps = {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly Option[];
};

/** A labelled select that submits with the form. */
function Select({ name, label, value, options }: SelectProps): ReactNode {
  return (
    <select
      name={name}
      aria-label={label}
      defaultValue={value}
      className={controlClass}
    >
      {options.map((item) => (
        <option key={item.value} value={item.value}>
          {item.label}
        </option>
      ))}
    </select>
  );
}

/** The phone "Filters" button, with how many filters are active. */
function FiltersSummary({ active }: { readonly active: number }): ReactNode {
  return (
    <summary className={summaryClass}>
      <Icon name="dots" size={18} />
      Filters
      {active > 0 ? (
        <span className="ml-1 rounded-round bg-accent px-2 text-xs font-bold text-accent-ink">
          {active}
        </span>
      ) : null}
    </summary>
  );
}

const statusOptions: readonly Option[] = [
  option('established', 'Established'),
  option('provisional', 'Provisional'),
  option('everyone', 'Everyone'),
];
const bandOptions: readonly Option[] = [
  option('any', 'Any band'),
  ...[...bloomBands].reverse().map((band) => option(band, bloomLabel(band))),
];
const regionOptions: readonly Option[] = [
  option('any', 'Any region'),
  ...regions.map((region) => option(region, regionLabel(region))),
];

/**
 * Season, scope, search and the status, band and region filters as one GET
 * form: the URL carries the state, so the ladder filters on the server with
 * no script. On the phone the three filters live behind "Filters".
 */
export function LadderFilters({
  query,
  seasons,
  season,
  hasStanding,
}: LadderFiltersProps) {
  const active = activeFilterCount(query);
  const seasonOptions = seasons.map((item) =>
    option(
      String(item.id),
      `${seasonLabel(item)} (${isClosed(item) ? 'closed' : 'current'})`,
    ),
  );
  return (
    <AutoSubmitForm
      action="/leaderboard"
      role="search"
      aria-label="Filter the ladder"
      className="flex flex-wrap items-center gap-x-3 gap-y-3"
    >
      {query.scope === 'around' ? (
        <input type="hidden" name="scope" value="around" />
      ) : null}
      {hasStanding ? (
        <Segmented
          label="Scope"
          segments={[
            {
              label: 'Top of the ladder',
              href: scopeHref(query, 'top'),
              selected: query.scope === 'top',
            },
            {
              label: 'Around me',
              href: scopeHref(query, 'around'),
              selected: query.scope === 'around',
            },
          ]}
        />
      ) : null}
      <label
        className={`${controlClass} flex grow basis-1/6 items-center gap-2 text-ink-muted`}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Search for a debater"
          aria-label="Search for a debater"
          className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
        />
      </label>
      <label className="flex items-center gap-2 text-sm text-ink-faint">
        <span className="max-compact:sr-only">Season</span>
        <Select
          name="season"
          label="Season"
          value={String(season.id)}
          options={seasonOptions}
        />
      </label>
      <details className={`contents ${panelClass}`}>
        <FiltersSummary active={active} />
        <div className="contents max-compact:grid max-compact:grid-cols-1 max-compact:gap-3">
          <Select
            name="status"
            label="Status"
            value={query.status}
            options={statusOptions}
          />
          <Select
            name="band"
            label="Band"
            value={query.band}
            options={bandOptions}
          />
          <Select
            name="region"
            label="Region, shown only for debaters who chose to show one"
            value={query.region}
            options={regionOptions}
          />
        </div>
        {isFiltered(query) ? (
          <Link
            href={clearFiltersHref(query)}
            className="flex min-h-10 items-center px-1 text-base font-strong"
          >
            Clear
          </Link>
        ) : null}
      </details>
      <button type="submit" className={buttonClass('secondary')}>
        Apply
      </button>
      <p className="basis-full text-xs text-ink-faint">
        {`Hollow marker and a question mark mean provisional: fewer than ${PROVISIONAL_AFTER} ranked debates. Provisional debaters are not ranked.`}
      </p>
    </AutoSubmitForm>
  );
}
