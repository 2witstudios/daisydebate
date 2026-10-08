import Link from 'next/link';
import { prepDestinations } from '../../../features/prep/actions';
import {
  emptyKind,
  resultsLine,
} from '../../../features/prep/library/library-labels';
import {
  hasFilters,
  libraryHref,
  type LibraryQuery,
  type LibraryView,
} from '../../../features/prep/library/library-query';
import type { LibraryListing } from '../../../features/prep/library/list-library';
import { buttonClass } from '../../components/button/button-class';
import { FirstVisit } from '../first-visit/first-visit';
import {
  FiltersHideEverything,
  NoResults,
} from '../library-empty/library-empty';
import { LibraryList } from '../library-row/library-row';
import { PrepIcon } from '../prep-icon/prep-icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { LibraryFilters } from './library-filters';

export type LibraryProps = {
  readonly listing: LibraryListing;
  readonly query: LibraryQuery;
};

const tabs: readonly { id: LibraryView; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'briefs', label: 'Briefs' },
  { id: 'cards', label: 'Cards' },
  { id: 'cases', label: 'Cases' },
];

const link = 'no-underline hover:no-underline';

function EmptyResults(props: {
  readonly query: LibraryQuery;
  readonly searchMatches: number;
}) {
  const kind = emptyKind(props.query, props.searchMatches);
  if (kind === 'no-results') return <NoResults query={props.query} />;
  if (kind === 'filters-hide')
    return (
      <FiltersHideEverything
        query={props.query}
        searchMatches={props.searchMatches}
      />
    );
  return (
    <p className="rounded-lg border border-border bg-surface-raised px-6 py-10 text-center text-base text-ink-muted">
      {`No ${props.query.view} yet.`}
    </p>
  );
}

/**
 * The Prep library: the owner's briefs, evidence cards and cases, as one
 * card: tabs, then the search toolbar, then the rows. Every piece of state
 * (tab, search, filters, sort) is in the URL.
 */
export function Library({ listing, query }: LibraryProps) {
  if (listing.total === 0) return <FirstVisit />;
  const shown = listing.counts[query.view];
  const narrowed = hasFilters(query) || query.q !== '';
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
          Prep
        </h1>
        <div className="flex flex-wrap items-center gap-3 max-compact:w-full">
          <Link
            href={prepDestinations.importSource}
            className={`${buttonClass('ghost')} ${link}`}
          >
            <PrepIcon name="upload" size={18} />
            Import source
          </Link>
          <Link
            href={prepDestinations.newBrief}
            className={`${buttonClass('secondary')} ${link}`}
          >
            <PrepIcon name="doc" size={18} />
            New brief
          </Link>
          <Link
            href={prepDestinations.addEvidence}
            className={`${buttonClass('primary')} ${link} max-compact:grow`}
          >
            <PrepIcon name="plus" size={18} />
            Add evidence
          </Link>
        </div>
      </header>
      <section
        aria-label="Your library"
        className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-1"
      >
        <div className="px-5 max-compact:px-4">
          <PrepTabs
            label="View"
            current={query.view}
            tabs={tabs.map(({ id, label }) => ({
              id,
              label,
              href: libraryHref({ ...query, view: id }),
              count: listing.counts[id],
            }))}
          />
        </div>
        <div className="border-b border-border px-5 py-3 max-compact:px-4">
          <LibraryFilters
            query={query}
            options={listing.options}
            savedSearches={listing.savedSearches}
          />
        </div>
        {narrowed && shown > 0 ? (
          <p className="border-b border-border px-5 py-2 text-sm text-ink-muted max-compact:px-4">
            {resultsLine(query, shown)}
          </p>
        ) : null}
        {shown === 0 ? (
          <div className="p-5">
            <EmptyResults query={query} searchMatches={listing.searchMatches} />
          </div>
        ) : (
          <LibraryList label="Library items" rows={listing.rows} />
        )}
      </section>
      <p className="text-sm text-ink-faint">
        Private to you.
        {listing.teams.length > 0 ? (
          <>
            {' '}
            <Link href={`/prep/teams/${listing.teams[0]?.id}`}>
              {`Team: ${listing.teams[0]?.name}`}
            </Link>
          </>
        ) : null}
      </p>
    </div>
  );
}
