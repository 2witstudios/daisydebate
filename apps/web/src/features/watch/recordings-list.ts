import {
  debateRating,
  isParticipant,
  type Debater,
  type WatchDebate,
  type WatchViewer,
} from './debate';
import { matchesFilters } from './live-list';
import type { RecordingsQuery } from './recordings-query';

/** An ended debate whose recording can be replayed. */
export type RecordedDebate = WatchDebate & {
  readonly state: Extract<WatchDebate['state'], { status: 'ended' }>;
};

const isReady = (debate: WatchDebate): debate is RecordedDebate =>
  debate.state.status === 'ended' &&
  debate.state.recording.availability === 'ready';

/**
 * The archive lists public recordings; the viewer's own scope adds their
 * unlisted and private ones. Anyone else's non-public recording never shows.
 */
const inScope = (
  debate: WatchDebate,
  query: RecordingsQuery,
  viewer: WatchViewer,
): boolean =>
  query.scope === 'mine'
    ? isParticipant(debate, viewer)
    : debate.visibility === 'public';

const byId = (x: RecordedDebate, y: RecordedDebate) => x.id.localeCompare(y.id);

const comparators = {
  newest: (x: RecordedDebate, y: RecordedDebate) =>
    y.state.recording.endedAt.localeCompare(x.state.recording.endedAt) ||
    byId(x, y),
  longest: (x: RecordedDebate, y: RecordedDebate) =>
    y.state.recording.lengthSeconds - x.state.recording.lengthSeconds ||
    byId(x, y),
  rated: (x: RecordedDebate, y: RecordedDebate) =>
    debateRating(y) - debateRating(x) || byId(x, y),
} as const;

export type RecordingsListing = {
  readonly rows: readonly RecordedDebate[];
  /** Recordings in the scope before mode and search filters. */
  readonly inScope: number;
};

/** Scopes, filters and sorts the replayable recordings for one query. */
export function buildRecordingsListing(
  debates: readonly WatchDebate[],
  query: RecordingsQuery,
  viewer: WatchViewer,
): RecordingsListing {
  const scoped = debates
    .filter(isReady)
    .filter((debate) => inScope(debate, query, viewer));
  return {
    rows: scoped
      .filter((debate) => matchesFilters(debate, query))
      .sort(comparators[query.sort]),
    inScope: scoped.length,
  };
}

/** What to call a debater in the viewer's own list: "You" for themselves. */
export const debaterName = (debater: Debater, viewer: WatchViewer): string =>
  viewer.signedIn && viewer.handle === debater.handle
    ? 'You'
    : `@${debater.handle}`;
