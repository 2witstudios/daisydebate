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

type Option = readonly [string, string];

function Select(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly Option[];
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

const statusOptions: readonly Option[] = [
  ['established', 'Established'],
  ['provisional', 'Provisional'],
  ['everyone', 'Everyone'],
];
const bandOptions: readonly Option[] = [
  ['any', 'Any band'],
  ...[...bloomBands].reverse().map((band): Option => [band, bloomLabel(band)]),
];
const regionOptions: readonly Option[] = [
  ['any', 'Any region'],
  ...regions.map((region): Option => [region, regionLabel(region)]),
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
  const seasonOptions = seasons.map((item): Option => [
    String(item.id),
    `${seasonLabel(item)} (${isClosed(item) ? 'closed' : 'current'})`,
  ]);
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
        <summary className={summaryClass}>
          <Icon name="dots" size={18} />
          Filters
          {active > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-round bg-accent px-2 text-xs font-bold text-accent-ink">
              {active}
            </span>
          ) : null}
        </summary>
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
