import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { archiveEntries } from '../../../features/recording/archive';
import { parseRecordingsQuery } from '../../../features/recording/archive-query';
import { recordingViewerOf } from '../../../features/recording/viewer';
import {
  readRecordingArchive,
  requestHubCounts,
  requestIdentity,
} from '../../../lib/request-session';
import { RecordingsTab } from '../../../ui/watch/recordings-tab/recordings-tab';
import { WatchHub } from '../../../ui/watch/watch-hub/watch-hub';

export const metadata: Metadata = { title: 'Recordings' };

/** The archive of finished Rounds, under the Watch hub. */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = recordingViewerOf(await requestIdentity());
  const query = parseRecordingsQuery(await searchParams);
  const [{ page }, counts] = await Promise.all([
    readRecordingArchive(query, viewer),
    requestHubCounts(),
  ]);
  return (
    <WatchHub active="recordings" counts={counts}>
      <RecordingsTab
        query={query}
        listing={{
          rows: archiveEntries(page, viewer),
          nextBefore: page.nextBefore,
        }}
      />
    </WatchHub>
  );
}
