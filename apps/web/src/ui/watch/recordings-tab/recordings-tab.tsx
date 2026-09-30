import Link from 'next/link';
import type { RecordingsHubListing } from '../../../features/watch/list-recordings';
import { MAX_SEARCH_LENGTH } from '../../../features/watch/live-query';
import {
  clearRecordingFiltersHref,
  isRecordingsFiltered,
  type RecordingsQuery,
} from '../../../features/watch/recordings-query';
import { watchRoutes } from '../../../features/watch/routes';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { cn } from '../../cn';
import { AutoSubmitForm } from '../../lobby/filter-bar/auto-submit-form';
import { controlClass } from '../../lobby/filter-bar/filter-bar-class';
import { ModeToggle } from '../../lobby/mode-toggle/mode-toggle';
import { ActionLink } from '../action-link/action-link';
import {
  RecordingRow,
  recordingGridClass,
} from '../recording-row/recording-row';
import { ScopeToggle } from '../scope-toggle/scope-toggle';
import { StateCard } from '../state-card/state-card';

export type RecordingsTabProps = {
  readonly query: RecordingsQuery;
  readonly listing: RecordingsHubListing;
};

const sortOptions = [
  ['newest', 'Newest'],
  ['longest', 'Longest'],
  ['rated', 'Highest rated'],
] as const;

function Filters({ query }: { query: RecordingsQuery }) {
  return (
    <AutoSubmitForm
      action={watchRoutes.recordings}
      role="search"
      aria-label="Filter recordings"
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
          placeholder="Search recordings or debaters"
          aria-label="Search recordings or debaters"
          className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint"
        />
      </label>
      <ScopeToggle value={query.scope} />
      <ModeToggle value={query.mode} />
      <select
        name="sort"
        aria-label="Sort recordings"
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
      {isRecordingsFiltered(query) ? (
        <Link
          href={clearRecordingFiltersHref(query)}
          className="flex min-h-10 items-center px-1 text-base font-strong"
        >
          Clear
        </Link>
      ) : null}
    </AutoSubmitForm>
  );
}

function Empty({ query, listing }: RecordingsTabProps) {
  if (listing.inScope > 0)
    return (
      <StateCard
        icon="search"
        title="No recordings match"
        actions={
          <ActionLink href={clearRecordingFiltersHref(query)}>
            Clear filters
          </ActionLink>
        }
      >
        <p>
          Try another search, or clear the filters to see every recording in
          this list.
        </p>
      </StateCard>
    );
  if (query.scope === 'mine')
    return (
      <StateCard
        icon="play"
        title="You have no recorded debates yet"
        actions={
          <>
            <ActionLink href={watchRoutes.findMatch} variant="primary">
              Find a match
            </ActionLink>
            <ActionLink href={watchRoutes.lobby}>Open the lobby</ActionLink>
          </>
        }
      >
        <p>
          Every debate you play is recorded when it ends. It starts with the
          visibility you chose for the room, and you can change it later.
        </p>
      </StateCard>
    );
  return (
    <StateCard
      icon="play"
      title="No recordings yet"
      actions={<ActionLink href={watchRoutes.hub}>See what is live</ActionLink>}
    >
      <p>
        Public debates are added to the archive when they end. The first ones
        will show up here with their timeline and ballot.
      </p>
    </StateCard>
  );
}

/** The archive: scope, filters and one row per recording, or an empty state. */
export function RecordingsTab({ query, listing }: RecordingsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Filters query={query} />
      <p className="flex items-center gap-2 text-sm text-ink-muted">
        <Icon name="globe" size={16} />
        The public archive lists public debates only. My debates also shows your
        unlisted and private ones, which only you and the people seated can
        open.
      </p>
      {listing.rows.length === 0 ? (
        <Empty query={query} listing={listing} />
      ) : (
        <section
          aria-label="Recordings"
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
        >
          <div
            aria-hidden="true"
            className={cn(
              recordingGridClass,
              'px-5 py-3 text-2xs font-bold tracking-wider text-ink-faint uppercase max-compact:hidden',
            )}
          >
            <span className="col-span-5">Debate</span>
            <span className="col-span-3">Debaters</span>
            <span className="col-span-2">Result</span>
          </div>
          <ul>
            {listing.rows.map((row) => (
              <RecordingRow key={row.id} row={row} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
