import type { LiveHubListing } from '../../../features/watch/list-live';
import {
  clearFiltersHref,
  isFiltered,
  type LiveQuery,
} from '../../../features/watch/live-query';
import { watchRoutes } from '../../../features/watch/routes';
import { ActionLink } from '../action-link/action-link';
import { FilterForm } from '../filter-form/filter-form';
import { FeaturedDebate } from '../featured-debate/featured-debate';
import { InertButton } from '../inert-button/inert-button';
import { LiveCard } from '../live-card/live-card';
import { StateCard } from '../state-card/state-card';

export type LiveTabProps = {
  readonly query: LiveQuery;
  readonly listing: LiveHubListing;
};

const sortOptions = [
  ['watched', 'Most watched'],
  ['rated', 'Highest rated'],
] as const;

function Filters({ query }: { query: LiveQuery }) {
  return (
    <FilterForm
      action={watchRoutes.hub}
      label="Filter live debates"
      search={{
        value: query.q,
        label: 'Search debaters or rooms',
        placeholder: 'Search debaters or rooms',
      }}
      mode={query.mode}
      sort={{
        value: query.sort,
        label: 'Sort live debates',
        options: sortOptions,
      }}
      clearHref={isFiltered(query) ? clearFiltersHref(query) : null}
    />
  );
}

/** The hub's live section: filters, the featured debate and the live list. */
export function LiveTab({ query, listing }: LiveTabProps) {
  if (listing.total === 0)
    return (
      <StateCard
        icon="eye"
        title="Nothing live right now"
        actions={
          <>
            <InertButton action="notify" variant="primary">
              Tell me when ranked debates start
            </InertButton>
            <ActionLink href={watchRoutes.recordings}>
              Browse recordings
            </ActionLink>
            <ActionLink href={watchRoutes.lobby} variant="ghost">
              Open the lobby
            </ActionLink>
          </>
        }
      />
    );

  const nothingMatches = listing.featured === null && listing.rows.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <Filters query={query} />
      {listing.featured ? (
        <FeaturedDebate
          card={listing.featured}
          delaySeconds={listing.delaySeconds}
        />
      ) : null}
      {listing.rows.length > 0 ? (
        <ul className="grid grid-cols-3 gap-4 max-rail:grid-cols-2 max-compact:grid-cols-1">
          {listing.rows.map((card) => (
            <li key={card.id} className="contents">
              <LiveCard card={card} />
            </li>
          ))}
        </ul>
      ) : null}
      {nothingMatches ? (
        <StateCard
          icon="search"
          title="No live debates match"
          actions={
            <ActionLink href={clearFiltersHref(query)}>
              Clear filters
            </ActionLink>
          }
        />
      ) : null}
    </div>
  );
}
