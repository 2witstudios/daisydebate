import type { Metadata } from 'next';
import { redirectUnlessLaunched } from '../../../features/coming-soon/launch-gate';
import type { SearchParams } from '../../../features/access/decision';
import { archiveEntries } from '../../../features/recording/archive';
import { parseRecordingsQuery } from '../../../features/recording/archive-query';
import { recordingViewerOf } from '../../../features/recording/viewer';
import { countHub } from '../../../features/watch/list-live';
import { watchSource } from '../../../features/watch/round-source';
import {
  readRecordingArchive,
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
  redirectUnlessLaunched('watch');
  const viewer = recordingViewerOf(await requestIdentity());
  const query = parseRecordingsQuery(await searchParams);
  const { page, publicCount } = await readRecordingArchive(query, viewer);
  return (
    <WatchHub
      active="recordings"
      counts={{ ...countHub(watchSource), recordings: publicCount }}
    >
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
