import Link from 'next/link';
import type { ReactNode } from 'react';
import {
  MAX_FIELD_LENGTH,
  activeFilterCount,
  clearSearchHref,
  hasFilters,
  librarySorts,
  type LibraryQuery,
  type LibrarySort,
} from '../../../features/prep/library-query';
import type { LibraryListing } from '../../../features/prep/list-library';
import { inertActions } from '../../../features/prep/actions';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import {
  controlClass,
  panelClass,
  summaryClass,
} from './library-filters-class';

const sortLabels: Readonly<Record<LibrarySort, string>> = {
  recent: 'Recently edited',
  title: 'Title',
  used: 'Most used',
};

function Field(props: {
  readonly name: string;
  readonly label: string;
  readonly value: string;
  readonly anyLabel: string;
  readonly options: readonly string[];
}): ReactNode {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-xs font-strong text-ink-muted">
      {props.label}
      <select
        name={props.name}
        defaultValue={props.value}
        className={controlClass}
      >
        <option value="">{props.anyLabel}</option>
        {props.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

export type LibraryFiltersProps = {
  readonly query: LibraryQuery;
  readonly options: LibraryListing['options'];
};

/**
 * Search and filters as one GET form: the URL carries the state, so a
 * search can be bookmarked, and it works with no script. On the phone the
 * four selects sit behind a native Filters disclosure.
 */
export function LibraryFilters({ query, options }: LibraryFiltersProps) {
  const active = activeFilterCount(query);
  return (
    <form
      action="/prep"
      method="get"
      role="search"
      aria-label="Search your library"
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="view" value={query.view} />
      <input type="hidden" name="in" value={query.in} />
      <div className="flex gap-3">
        <label
          className={`${controlClass} flex grow items-center gap-2 text-ink-muted`}
        >
          <Icon name="search" size={16} />
          <input
            type="search"
            name="q"
            defaultValue={query.q}
            maxLength={MAX_FIELD_LENGTH}
            placeholder="Search titles, passages, authors and tags"
            aria-label="Search titles, passages, authors and tags"
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
          />
        </label>
        <button type="submit" className={buttonClass('primary')}>
          Search
        </button>
      </div>
      <details className={panelClass}>
        <summary className={summaryClass}>
          <PrepIcon name="filter" size={18} />
          Filters
          {active > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-round bg-accent px-2 text-xs font-bold text-accent-ink">
              {active}
            </span>
          ) : null}
        </summary>
        <div className="grid grid-cols-4 gap-3 max-compact:grid-cols-2 max-compact:pt-3">
          <Field
            name="tag"
            label="Tag"
            value={query.tag}
            anyLabel="Any tag"
            options={options.tags}
          />
          <label className="flex min-w-0 flex-col gap-1 text-xs font-strong text-ink-muted">
            Side
            <select
              name="side"
              defaultValue={query.side}
              className={controlClass}
            >
              <option value="any">Either side</option>
              <option value="aff">Aff</option>
              <option value="neg">Neg</option>
            </select>
          </label>
          <Field
            name="motion"
            label="Motion"
            value={query.motion}
            anyLabel="All motions"
            options={options.motions}
          />
          <Field
            name="source"
            label="Source"
            value={query.source}
            anyLabel="Any source"
            options={options.sources}
          />
        </div>
      </details>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-prose text-sm text-ink-faint">
          Filters are in the address, so a search can be bookmarked or shared
          with a teammate who can open the same items.
        </p>
        <div className="flex items-center gap-1">
          <label className="flex items-center gap-2 text-sm text-ink-faint">
            <span>Sort</span>
            <select
              name="sort"
              defaultValue={query.sort}
              className={`${controlClass} h-10`}
            >
              {librarySorts.map((sort) => (
                <option key={sort} value={sort}>
                  {sortLabels[sort]}
                </option>
              ))}
            </select>
          </label>
          <InertActionButton
            action={inertActions.saveSearch}
            variant="ghost"
            symbol="bookmark"
          />
          {hasFilters(query) || query.q !== '' ? (
            <Link
              href={clearSearchHref(query)}
              className={`${buttonClass('ghost')} no-underline hover:no-underline`}
            >
              Clear
            </Link>
          ) : null}
        </div>
      </div>
    </form>
  );
}
