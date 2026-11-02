import type { WatchViewer } from './round';
import type { WatchSource } from './round-source';
import { recordingRowOf, type RecordingRow } from './recording-row';
import { buildRecordingsListing } from './recordings-list';
import type { RecordingsQuery } from './recordings-query';

export type RecordingsHubListing = {
  readonly rows: readonly RecordingRow[];
  /** Recordings in the chosen scope before mode and search filters. */
  readonly inScope: number;
};

/**
 * The archive's data seam: the recordings a viewer may list for one query.
 */
export function listRecordings(
  query: RecordingsQuery,
  viewer: WatchViewer,
  source: WatchSource,
): RecordingsHubListing {
  const listing = buildRecordingsListing(source.rounds, query, viewer);
  return {
    rows: listing.rows.map((round) => recordingRowOf(round, viewer)),
    inScope: listing.inScope,
  };
}
