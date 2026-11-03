import type { ArchiveEntry } from '../../../features/recording/archive';
import {
  clearRecordingFiltersHref,
  isRecordingsFiltered,
  recordingsHref,
  type RecordingsQuery,
} from '../../../features/recording/archive-query';
import { watchRoutes } from '../../../features/watch/routes';
import { cn } from '../../cn';
import { FilterForm } from '../filter-form/filter-form';
import { ActionLink } from '../action-link/action-link';
import {
  RecordingRow,
  recordingGridClass,
} from '../recording-row/recording-row';
import { ScopeToggle } from '../scope-toggle/scope-toggle';
import { StateCard } from '../state-card/state-card';

export type RecordingsTabProps = {
  readonly query: RecordingsQuery;
  readonly listing: {
    readonly rows: readonly ArchiveEntry[];
    /** The Round the next page continues after, or null on the last. */
    readonly nextBefore: string | null;
  };
};

const sortOptions = [
  ['newest', 'Newest'],
  ['longest', 'Longest'],
] as const;

function Filters({ query }: { query: RecordingsQuery }) {
  return (
    <FilterForm
      action={watchRoutes.recordings}
      label="Filter recordings"
      search={{
        value: query.q,
        label: 'Search recordings or debaters',
        placeholder: 'Search recordings or debaters',
      }}
      leading={<ScopeToggle value={query.scope} />}
      mode={query.mode}
      sort={{
        value: query.sort,
        label: 'Sort recordings',
        options: sortOptions,
      }}
      clearHref={
        isRecordingsFiltered(query) ? clearRecordingFiltersHref(query) : null
      }
    />
  );
}

function Empty({ query }: { query: RecordingsQuery }) {
  if (isRecordingsFiltered(query))
    return (
      <StateCard
        icon="search"
        title="No recordings match"
        actions={
          <ActionLink href={clearRecordingFiltersHref(query)}>
            Clear filters
          </ActionLink>
        }
      />
    );
  if (query.scope === 'mine')
    return (
      <StateCard
        icon="play"
        title="No recorded debates yet"
        actions={
          <>
            <ActionLink href={watchRoutes.findMatch} variant="primary">
              Find a match
            </ActionLink>
            <ActionLink href={watchRoutes.lobby}>Open the lobby</ActionLink>
          </>
        }
      />
    );
  return (
    <StateCard
      icon="play"
      title="No recordings yet"
      actions={<ActionLink href={watchRoutes.hub}>See what is live</ActionLink>}
    />
  );
}

/** The archive: scope, filters and one row per recording, or an empty state. */
export function RecordingsTab({ query, listing }: RecordingsTabProps) {
  return (
    <div className="flex flex-col gap-4">
      <Filters query={query} />
      {listing.rows.length === 0 ? (
        <Empty query={query} />
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
              <RecordingRow key={row.roundId} row={row} />
            ))}
          </ul>
        </section>
      )}
      {listing.nextBefore ? (
        <ActionLink
          href={recordingsHref({ ...query, before: listing.nextBefore })}
        >
          Older recordings
        </ActionLink>
      ) : null}
    </div>
  );
}
