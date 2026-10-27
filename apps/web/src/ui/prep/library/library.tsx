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
import { LibraryPreview } from '../library-preview/library-preview';
import { Icon } from '../../components/icon/icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { LibraryFilters } from './library-filters';

export type LibraryProps = {
  readonly listing: LibraryListing;
  readonly query: LibraryQuery;
};

const tabs: readonly { id: LibraryView; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'cards', label: 'Cards' },
  { id: 'briefs', label: 'Briefs' },
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
 * The Prep library: the owner's briefs, evidence cards and cases as a list
 * beside a preview of the selected one (a phone has the list only). Every
 * piece of state (tab, search, filters, sort, selection) is in the URL.
 */
export function Library({ listing, query }: LibraryProps) {
  if (listing.total === 0) return <FirstVisit />;
  const shown = listing.counts[query.view];
  const narrowed = hasFilters(query) || query.q !== '';
  return (
    <div className="flex w-full flex-col">
      <header className="flex flex-wrap items-center gap-3 px-6 pt-5 pb-3 max-compact:px-4">
        <h1 className="flex-1 font-display text-2xl leading-tight font-bold tracking-tight">
          Prep
        </h1>
        <Link
          href={prepDestinations.importSource}
          aria-label="Import source"
          className={`${buttonClass('ghost')} ${link}`}
        >
          <Icon name="upload" size={18} />
          <span className="max-compact:hidden">Import source</span>
        </Link>
        <Link
          href={prepDestinations.newBrief}
          aria-label="New brief"
          className={`${buttonClass('secondary')} ${link}`}
        >
          <Icon name="doc" size={18} />
          <span className="max-compact:hidden">New brief</span>
        </Link>
        <Link
          href={prepDestinations.addEvidence}
          className={`${buttonClass('primary')} ${link}`}
        >
          <Icon name="plus" size={18} />
          Add evidence
        </Link>
      </header>
      <div className="px-6 pb-3 max-compact:px-4">
        <LibraryFilters query={query} listing={listing} />
      </div>
      <div className="flex min-h-0 flex-1 border-t border-border">
        <section
          aria-label="Your library"
          className="flex w-prep-list shrink-0 flex-col border-r border-border bg-surface max-compact:w-full max-compact:border-r-0"
        >
          <div className="px-4">
            <PrepTabs
              label="View"
              current={query.view}
              tabs={tabs.map(({ id, label }) => ({
                id,
                label,
                href: libraryHref({ ...query, view: id, item: '' }),
                count: listing.counts[id],
              }))}
            />
          </div>
          {narrowed && shown > 0 ? (
            <p className="border-b border-border px-4 py-2 text-sm text-ink-muted">
              {resultsLine(query, shown)}
            </p>
          ) : null}
          {shown === 0 ? (
            <div className="p-4">
              <EmptyResults
                query={query}
                searchMatches={listing.searchMatches}
              />
            </div>
          ) : (
            <LibraryList label="Library items" rows={listing.rows} />
          )}
        </section>
        {listing.preview === undefined ? null : (
          <LibraryPreview preview={listing.preview} />
        )}
      </div>
    </div>
  );
}
