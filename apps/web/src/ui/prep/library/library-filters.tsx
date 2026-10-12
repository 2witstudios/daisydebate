import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  MAX_FIELD_LENGTH,
  clearSearchHref,
  hasFilters,
  librarySorts,
  type LibraryQuery,
  type LibrarySort,
} from '../../../features/prep/library/library-query';
import type { LibraryListing } from '../../../features/prep/library/list-library';
import { Icon } from '../../components/icon/icon';
import { PrepIcon } from '../prep-icon/prep-icon';

const sortLabels: Readonly<Record<LibrarySort, string>> = {
  recent: 'Recently edited',
  title: 'Title',
  used: 'Most used',
};

const pill =
  'inline-flex h-prep-control min-w-0 items-center gap-1 rounded-round border border-border-strong bg-surface-raised px-3 text-sm text-ink no-underline hover:no-underline';
const savedPill =
  'inline-flex h-prep-control items-center gap-2 rounded-round bg-hue-sky-soft px-3 text-sm font-strong text-hue-sky no-underline hover:no-underline';
const teamPill =
  'inline-flex h-prep-control items-center gap-1 rounded-round bg-hue-teal-soft px-3 text-sm font-strong text-hue-teal no-underline hover:no-underline';

function Filter(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly options: readonly { value: string; label: string }[];
}): ReactNode {
  return (
    <label className="flex">
      <span className="sr-only">{props.label}</span>
      <select name={props.name} defaultValue={props.value} className={pill}>
        {props.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

const anyOf = (anyLabel: string, values: readonly string[]) => [
  { value: '', label: anyLabel },
  ...values.map((value) => ({ value, label: value })),
];

export type LibraryFiltersProps = {
  readonly query: LibraryQuery;
  readonly listing: LibraryListing;
};

/**
 * The library's filter row: search, tag, side, motion, source and sort as
 * one GET form (the URL carries the state, and it works with no script),
 * then the saved searches and teams as links.
 */
export function LibraryFilters({ query, listing }: LibraryFiltersProps) {
  const { options, savedSearches, teams } = listing;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        action="/prep"
        method="get"
        role="search"
        aria-label="Search your library"
        className="flex flex-wrap items-center gap-2 max-compact:w-full"
      >
        <input type="hidden" name="view" value={query.view} />
        <input type="hidden" name="in" value={query.in} />
        <label className="flex h-prep-control w-prep-search min-w-0 items-center gap-2 rounded-md border border-border-strong bg-surface-raised px-3 text-ink-muted max-compact:w-full">
          <Icon name="search" size={16} />
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={MAX_FIELD_LENGTH}
            aria-label="Search titles, passages, authors and tags"
            className="min-w-0 flex-1 bg-transparent text-base text-ink"
          />
        </label>
        <Filter
          name="tag"
          label="Tag"
          value={query.tag}
          options={anyOf('Any tag', options.tags)}
        />
        <Filter
          name="side"
          label="Side"
          value={query.side}
          options={[
            { value: 'any', label: 'Either side' },
            { value: 'aff', label: 'Aff' },
            { value: 'neg', label: 'Neg' },
          ]}
        />
        <Filter
          name="motion"
          label="Motion"
          value={query.motion}
          options={anyOf('All motions', options.motions)}
        />
        <Filter
          name="source"
          label="Source"
          value={query.source}
          options={anyOf('Any source', options.sources)}
        />
        <Filter
          name="sort"
          label="Sort"
          value={query.sort}
          options={librarySorts.map((sort) => ({
            value: sort,
            label: sortLabels[sort],
          }))}
        />
        <button type="submit" className={`${pill} cursor-pointer font-strong`}>
          <PrepIcon name="filter" size={16} />
          Apply
        </button>
        {hasFilters(query) || query.q !== '' ? (
          <Link href={clearSearchHref(query)} className={pill}>
            Clear
          </Link>
        ) : null}
      </form>
      {savedSearches.length > 0 ? (
        <nav
          aria-label="Saved searches"
          className="flex flex-wrap items-center gap-2 border-l border-border pl-3 text-xs text-ink-faint max-compact:border-l-0 max-compact:pl-0"
        >
          <span>Saved:</span>
          {savedSearches.map((saved) => (
            <Link key={saved.id} href={saved.href} className={savedPill}>
              {saved.name}
              <span className="font-book tabular-nums">{saved.count}</span>
            </Link>
          ))}
        </nav>
      ) : null}
      {teams.length > 0 ? (
        <nav
          aria-label="Teams"
          className="ml-auto flex flex-wrap items-center gap-2 max-compact:ml-0"
        >
          {teams.map((team) => (
            <Link
              key={team.id}
              href={`/prep/teams/${team.id}`}
              className={teamPill}
            >
              {`Team: ${team.name}`}
              <span className="font-book tabular-nums">{team.sharedCount}</span>
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
}
