import Link from 'next/link';
import type { LiveHubListing } from '../../../features/watch/list-live';
import {
  MAX_SEARCH_LENGTH,
  clearFiltersHref,
  isFiltered,
  type LiveQuery,
} from '../../../features/watch/live-query';
import { watchRoutes } from '../../../features/watch/routes';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
import { ModeToggle } from '../../lobby/mode-toggle/mode-toggle';
import { ActionLink } from '../action-link/action-link';
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
    <AutoSubmitForm
      action={watchRoutes.hub}
      role="search"
      aria-label="Filter live debates"
      className="flex flex-wrap items-center gap-x-3 gap-y-3"
    >
      <label
        className={cn(
          controlClass,
          'flex grow basis-1/4 items-center gap-2 text-ink-muted',
        )}
      >
        <Icon name="search" size={16} />
        <input
          type="search"
          name="q"
          defaultValue={query.q}
          maxLength={MAX_SEARCH_LENGTH}
          placeholder="Search debaters or rooms"
          aria-label="Search debaters or rooms"
          className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
        />
      </label>
      <ModeToggle value={query.mode} />
      <select
        name="sort"
        aria-label="Sort live debates"
        defaultValue={query.sort}
        className={controlClass}
      >
        {sortOptions.map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <button type="submit" className={buttonClass('secondary')}>
        Apply
      </button>
      {isFiltered(query) ? (
        <Link
          href={clearFiltersHref(query)}
          className="flex min-h-10 items-center px-1 text-base font-strong"
        >
          Clear
        </Link>
      ) : null}
    </AutoSubmitForm>
  );
}

/** The hub's live section: filters, the featured debate and the live list. */
export function LiveTab({ query, listing }: LiveTabProps) {
  if (listing.total === 0)
    return (
      <StateCard
        icon="eye"
        title="No debates are live right now"
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
      >
        <p>
          Public ranked and casual debates appear here while they run, and leave
          when they end. Unlisted and private rooms are never listed. Recent
          debates are in the recordings archive.
        </p>
      </StateCard>
    );

  const nothingMatches = listing.featured === null && listing.rows.length === 0;
  return (
    <div className="flex flex-col gap-4">
      <Filters query={query} />
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Icon name="clock" size={16} />
        {`Spectators see every debate about ${listing.delaySeconds} seconds behind, so nobody can relay moves to a debater. Only public debates are listed.`}
      </p>
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
              <LiveCard card={card} delaySeconds={listing.delaySeconds} />
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
        >
          <p>
            Try a different search or mode, or clear the filters to see
            everything that is live.
          </p>
        </StateCard>
      ) : null}
    </div>
  );
}
