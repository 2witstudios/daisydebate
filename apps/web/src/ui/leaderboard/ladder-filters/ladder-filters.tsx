import Link from 'next/link';
import type { ReactNode } from 'react';
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
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
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

/** The "Filters" line that opens the panel, with how many are active. */
function FiltersSummary({ active }: { readonly active: number }): ReactNode {
  return (
    <summary className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-sm font-strong text-ink">
      <Icon name="dots" size={16} />
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

/**
 * Season, scope, search and the status filter as one GET form: the URL
 * carries the state, so the ladder filters on the server with no script.
 * Scope and search sit in the first row; season and status live behind one
 * "Filters" line, open when either is active.
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
      className="flex flex-wrap items-center gap-x-3 gap-y-0"
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
        className={`${controlClass} flex min-w-0 grow items-center gap-2 text-ink-muted`}
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
      <details
        open={active > 0}
        className="contents details-content:flex details-content:basis-full details-content:flex-wrap details-content:items-center details-content:gap-3"
      >
        <FiltersSummary active={active} />
        <>
          <span aria-hidden="true" className="mt-3 h-px basis-full bg-border" />
          <label className="flex items-center gap-2 text-sm text-ink-faint">
            <span>Season</span>
            <Select
              name="season"
              label="Season"
              value={String(season.id)}
              options={seasonOptions}
            />
          </label>
          <Select
            name="status"
            label="Status"
            value={query.status}
            options={statusOptions}
          />
          {isFiltered(query) ? (
            <Link
              href={clearFiltersHref(query)}
              className="flex min-h-10 items-center px-1 text-base font-strong"
            >
              Clear
            </Link>
          ) : null}
          <button type="submit" className={buttonClass('secondary')}>
            Apply
          </button>
        </>
      </details>
    </AutoSubmitForm>
  );
}
