import {
  roundRating,
  isParticipant,
  type Debater,
  type WatchRound,
  type WatchViewer,
} from './round';
import { matchesFilters } from './live-list';
import type { RecordingsQuery } from './recordings-query';

/** An ended Round whose recording can be replayed. */
export type RecordedRound = WatchRound & {
  readonly state: Extract<WatchRound['state'], { status: 'ended' }>;
};

const isReady = (round: WatchRound): round is RecordedRound =>
  round.state.status === 'ended' &&
  round.state.recording.availability === 'ready';

/**
 * The archive lists public recordings; the viewer's own scope adds their
 * unlisted and private ones. Anyone else's non-public recording never shows.
 */
const inScope = (
  round: WatchRound,
  query: RecordingsQuery,
  viewer: WatchViewer,
): boolean =>
  query.scope === 'mine'
    ? isParticipant(round, viewer)
    : round.visibility === 'public';

const byId = (x: RecordedRound, y: RecordedRound) => x.id.localeCompare(y.id);

const comparators = {
  newest: (x: RecordedRound, y: RecordedRound) =>
    y.state.recording.endedAt.localeCompare(x.state.recording.endedAt) ||
    byId(x, y),
  longest: (x: RecordedRound, y: RecordedRound) =>
    y.state.recording.lengthSeconds - x.state.recording.lengthSeconds ||
    byId(x, y),
  rated: (x: RecordedRound, y: RecordedRound) =>
    roundRating(y) - roundRating(x) || byId(x, y),
} as const;

export type RecordingsListing = {
  readonly rows: readonly RecordedRound[];
  /** Recordings in the scope before mode and search filters. */
  readonly inScope: number;
};

/** Scopes, filters and sorts the replayable recordings for one query. */
export function buildRecordingsListing(
  rounds: readonly WatchRound[],
  query: RecordingsQuery,
  viewer: WatchViewer,
): RecordingsListing {
  const scoped = rounds
    .filter(isReady)
    .filter((round) => inScope(round, query, viewer));
  return {
    rows: scoped
      .filter((round) => matchesFilters(round, query))
      .sort(comparators[query.sort]),
    inScope: scoped.length,
  };
}

/** What to call a debater in the viewer's own list: "You" for themselves. */
export const debaterName = (debater: Debater, viewer: WatchViewer): string =>
  viewer.signedIn && viewer.handle === debater.handle
    ? 'You'
    : `@${debater.handle}`;
