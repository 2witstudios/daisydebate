import Link from 'next/link';
import {
  filterChips,
  libraryHref,
  clearFiltersHref,
  type LibraryQuery,
} from '../../../features/prep/library/library-query';
import { inertActions } from '../../../features/prep/actions';
import { buttonClass } from '../../components/button/button-class';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';

const box =
  'flex flex-col items-center gap-3 rounded-lg border border-border bg-surface-raised px-6 py-10 text-center';
const link = 'no-underline hover:no-underline';

/** A search that finds nothing, even with no filters in the way. */
export function NoResults({ query }: { readonly query: LibraryQuery }) {
  return (
    <section className={box} aria-label="No results">
      <PrepIcon name="search" size={28} className="text-ink-faint" />
      <h2 className="text-lg font-bold">{`No results for “${query.q}”`}</h2>
      {query.in === 'text' ? null : (
        <Link
          href={libraryHref({ ...query, in: 'text' })}
          className={`${buttonClass('secondary')} ${link}`}
        >
          Search full text
        </Link>
      )}
    </section>
  );
}

/** The search matches items, but the filters exclude every one. */
export function FiltersHideEverything(props: {
  readonly query: LibraryQuery;
  readonly searchMatches: number;
}) {
  const { query, searchMatches } = props;
  const what =
    query.q === ''
      ? `${searchMatches} ${searchMatches === 1 ? 'item' : 'items'} in your library`
      : `${searchMatches} ${searchMatches === 1 ? 'item matches' : 'items match'} “${query.q}”`;
  return (
    <section className={box} aria-label="No items match these filters">
      <h2 className="text-lg font-bold">Nothing matches these filters</h2>
      <p className="max-w-prose text-base text-ink-muted">{what}</p>
      <ul className="flex flex-wrap justify-center gap-2" aria-label="Filters">
        {filterChips(query).map((chip) => (
          <li
            key={chip.label}
            className="inline-flex items-center gap-1 rounded-round border border-border-strong bg-surface-overlay py-1 pr-1 pl-3 text-sm font-strong"
          >
            {chip.label}
            <Link
              href={chip.removeHref}
              aria-label={`Remove ${chip.label}`}
              className="inline-flex size-8 items-center justify-center rounded-round text-ink-muted hover:text-ink"
            >
              <PrepIcon name="x" size={14} />
            </Link>
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap justify-center gap-3">
        <Link
          href={clearFiltersHref(query)}
          className={`${buttonClass('secondary')} ${link}`}
        >
          Clear filters
        </Link>
        <InertActionButton
          action={inertActions.saveSearch}
          variant="ghost"
          symbol="bookmark"
        />
      </div>
    </section>
  );
}
