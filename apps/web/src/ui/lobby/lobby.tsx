import Link from 'next/link';
import { lobbyDestinations } from '../../features/lobby/actions';
import type { LobbyListing } from '../../features/lobby/list-rooms';
import { clearFiltersHref, type LobbyQuery } from '../../features/lobby/query';
import { buttonClass } from '../components/button/button-class';
import { cn } from '../cn';
import { FilterBar } from './filter-bar/filter-bar';
import { RoomTable } from './room-table/room-table';

export type LobbyProps = {
  readonly listing: LobbyListing;
  readonly query: LobbyQuery;
  /** ISO timestamp the waiting times count from. */
  readonly now: string;
};

const link = 'no-underline hover:no-underline';

/**
 * The lobby: the public browsing surface of open rooms and live debates.
 * Matchmaking is an action here, never a list.
 */
export function Lobby({ listing, query, now }: LobbyProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            Lobby
          </h1>
          <p className="text-base text-ink-muted">
            <span className="max-compact:hidden">
              Open tables and live rooms to watch.{' '}
            </span>
            <span className="text-ink-faint">
              {`Your rating ${listing.viewer.rating}`}
            </span>
          </p>
        </div>
        <div className="flex gap-3 max-compact:contents">
          <Link
            href={lobbyDestinations.openTable}
            className={cn(buttonClass('secondary'), link)}
          >
            Open a table
          </Link>
          <Link
            href={lobbyDestinations.findMatch}
            className={cn(buttonClass('primary'), link, 'max-compact:w-full')}
          >
            Find a match
          </Link>
        </div>
      </header>
      <FilterBar
        query={query}
        counts={listing.counts}
        resultCount={listing.rooms.length}
      />
      <RoomTable
        rooms={listing.rooms}
        viewer={listing.viewer}
        now={now}
        clearHref={clearFiltersHref(query)}
      />
    </div>
  );
}
