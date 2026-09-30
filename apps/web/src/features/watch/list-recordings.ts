import type { WatchViewer } from './debate';
import { listDebates } from './debate-source';
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
 * The backend read of recordings replaces `listDebates`; the scope and
 * visibility rules stay.
 */
export function listRecordings(
  query: RecordingsQuery,
  viewer: WatchViewer,
): RecordingsHubListing {
  const listing = buildRecordingsListing(listDebates(), query, viewer);
  return {
    rows: listing.rows.map((debate) => recordingRowOf(debate, viewer)),
    inScope: listing.inScope,
  };
}
