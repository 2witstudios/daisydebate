import Link from 'next/link';
import { prepDestinations } from '../../../features/prep/actions';
import { emptyKind, resultsLine } from '../../../features/prep/library-labels';
import {
  libraryHref,
  type LibraryQuery,
  type LibraryView,
} from '../../../features/prep/library-query';
import type { LibraryListing } from '../../../features/prep/list-library';
import { buttonClass } from '../../components/button/button-class';
import { FirstVisit } from '../first-visit/first-visit';
import { ItemTile } from '../item-tile/item-tile';
import { LibraryAside } from '../library-aside/library-aside';
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
 * The Prep library: the owner's briefs, evidence cards and cases. Every
 * piece of state (tab, search, filters, sort) is in the URL.
 */
export function Library({ listing, query }: LibraryProps) {
  if (listing.total === 0) return <FirstVisit />;
  const shown = listing.counts[query.view];
  return (
    <div className="mx-auto flex w-full max-w-dash-column gap-8 px-6 pt-5 pb-8 max-rail:flex-col max-compact:gap-4 max-compact:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-5">
        <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            Prep
          </h1>
          <div className="flex flex-wrap gap-3 max-compact:w-full">
            <Link
              href={prepDestinations.importSource}
              className={`${buttonClass('secondary')} ${link}`}
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
        <LibraryFilters query={query} options={listing.options} />
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
        {listing.jumpBackIn.length > 0 ? (
          <section
            aria-labelledby="jump-heading"
            className="flex flex-col gap-3"
          >
            <h2 id="jump-heading" className="text-md font-strong">
              Jump back in
            </h2>
            <ul className="grid grid-cols-3 gap-3 max-compact:grid-cols-1">
              {listing.jumpBackIn.map((row) => (
                <li key={row.id}>
                  <Link
                    href={row.href}
                    className="flex min-h-16 flex-col gap-2 rounded-lg border border-border bg-surface-raised p-4 text-ink no-underline shadow-1 hover:no-underline"
                  >
                    <ItemTile kind={row.kind} />
                    <span className="text-base font-strong">{row.title}</span>
                    <span className="text-sm text-ink-faint">{row.opened}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
        {shown === 0 ? (
          <EmptyResults query={query} searchMatches={listing.searchMatches} />
        ) : (
          <>
            <p className="text-sm text-ink-muted">
              {resultsLine(query, shown)}
            </p>
            <LibraryList label="Library items" rows={listing.rows} />
          </>
        )}
      </div>
      <LibraryAside
        savedSearches={listing.savedSearches}
        teams={listing.teams}
      />
    </div>
  );
}
