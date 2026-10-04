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
import type {
  LibraryListing,
  SavedSearch,
} from '../../../features/prep/list-library';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { PrepIcon } from '../prep-icon/prep-icon';
import { controlClass } from '../form-controls/form-class';

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
  readonly savedSearches: readonly SavedSearch[];
};

/**
 * The library's toolbar: search on one row, and everything else (tag, side,
 * motion, source, sort and your saved searches) behind one "Filters" line
 * that opens beneath it. One GET form, so the URL carries the state and it
 * works with no script; the panel is open while any filter is on.
 */
export function LibraryFilters({
  query,
  options,
  savedSearches,
}: LibraryFiltersProps) {
  const active = activeFilterCount(query);
  return (
    <form
      action="/prep"
      method="get"
      role="search"
      aria-label="Search your library"
      className="flex flex-wrap items-center gap-x-3 gap-y-0"
    >
      <input type="hidden" name="view" value={query.view} />
      <input type="hidden" name="in" value={query.in} />
      <label
        className={`${controlClass} flex min-w-0 grow items-center gap-2 text-ink-muted`}
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
      <details
        open={active > 0}
        className="contents details-content:flex details-content:basis-full details-content:flex-col details-content:gap-3"
      >
        <summary className="inline-flex h-12 cursor-pointer items-center gap-2 rounded-md border border-border bg-surface-raised px-3 text-sm font-strong text-ink">
          <PrepIcon name="filter" size={16} />
          Filters
          {active > 0 ? (
            <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-round bg-accent px-2 text-xs font-bold text-accent-ink">
              {active}
            </span>
          ) : null}
        </summary>
        <span aria-hidden="true" className="mt-3 h-px bg-border" />
        <div className="grid grid-cols-5 gap-3 max-compact:grid-cols-2">
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
          <label className="flex min-w-0 flex-col gap-1 text-xs font-strong text-ink-muted">
            Sort
            <select
              name="sort"
              defaultValue={query.sort}
              className={controlClass}
            >
              {librarySorts.map((sort) => (
                <option key={sort} value={sort}>
                  {sortLabels[sort]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button type="submit" className={buttonClass('secondary')}>
            Apply
          </button>
          {hasFilters(query) || query.q !== '' ? (
            <Link
              href={clearSearchHref(query)}
              className={`${buttonClass('ghost')} no-underline hover:no-underline`}
            >
              Clear
            </Link>
          ) : null}
          {savedSearches.length > 0 ? (
            <nav
              aria-label="Saved searches"
              className="flex flex-wrap items-center gap-2 text-sm text-ink-muted"
            >
              <span>Saved:</span>
              {savedSearches.map((saved) => (
                <Link
                  key={saved.id}
                  href={saved.href}
                  className="rounded-round border border-border px-3 py-1 text-ink no-underline hover:no-underline"
                >
                  {`${saved.name} · ${saved.count}`}
                </Link>
              ))}
            </nav>
          ) : null}
        </div>
      </details>
    </form>
  );
}
