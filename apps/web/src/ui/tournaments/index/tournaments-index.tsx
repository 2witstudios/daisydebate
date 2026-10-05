import type { ReactNode } from 'react';
import {
  clearFiltersHref,
  isFiltered,
  type TournamentsQuery,
} from '../../../features/tournaments/query';
import type { TournamentsListing } from '../../../features/tournaments/list-tournaments';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { LinkButton } from '../link-button/link-button';

import { PageHeader } from '../../components/page-header/page-header';
import { PageFrame } from '../page-frame/page-frame';
import { FeaturedTournament } from './featured/featured-tournament';
import { FilterBar } from './filter-bar/filter-bar';
import { NoMatches, NothingOpen } from './list-states/list-states';
import { Row } from './row/row';
import { YourTournaments } from './your-tournaments/your-tournaments';
import { rowColumnClass, rowGridClass } from './row/row-class';
import { cn } from '../../cn';

export type TournamentsIndexProps = {
  readonly listing: TournamentsListing;
  readonly query: TournamentsQuery;
};

const heading = cn(
  rowGridClass,
  'px-5 py-3 text-2xs font-bold tracking-wider text-ink-faint uppercase max-compact:hidden',
);

function List({ listing, query }: TournamentsIndexProps): ReactNode {
  if (listing.rows.length === 0)
    return isFiltered(query) ? (
      <NoMatches clearHref={clearFiltersHref(query)} />
    ) : (
      <NothingOpen />
    );
  return (
    <ul>
      {listing.rows.map((row) => (
        <Row key={row.tournament.id} row={row} />
      ))}
    </ul>
  );
}

/** The Tournaments index: browse, filter, and your own events. */
export function TournamentsIndex({ listing, query }: TournamentsIndexProps) {
  return (
    <PageFrame>
      <PageHeader
        title="Tournaments"
        actions={
          <LinkButton
            href={tournamentRoutes.create}
            className="max-compact:hidden"
          >
            Create a tournament
          </LinkButton>
        }
      />
      <div className="flex items-start gap-6 max-rail:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-6 max-rail:w-full">
          {listing.featured ? (
            <FeaturedTournament
              row={listing.featured}
              signedIn={listing.viewer !== null}
            />
          ) : null}
          <FilterBar
            query={query}
            counts={listing.counts}
            resultCount={listing.rows.length}
          />
          <section
            aria-label="Tournaments"
            className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
          >
            <div className={heading} aria-hidden="true">
              <span className={rowColumnClass('name')}>Tournament</span>
              <span className={rowColumnClass('when')}>When</span>
              <span className={rowColumnClass('slots')}>Places</span>
            </div>
            <List listing={listing} query={query} />
          </section>
        </div>
        <div className="w-rail shrink-0 max-rail:w-full">
          <YourTournaments
            yours={listing.yours}
            signedIn={listing.viewer !== null}
          />
        </div>
      </div>
    </PageFrame>
  );
}
