import type { Metadata } from 'next';
import { redirectUnlessLaunched } from '../../../features/coming-soon/launch-gate';
import type { SearchParams } from '../../../features/access/decision';
import { countHub } from '../../../features/watch/list-live';
import { listRecordings } from '../../../features/watch/list-recordings';
import { parseRecordingsQuery } from '../../../features/watch/recordings-query';
import { watchSource } from '../../../features/watch/round-source';
import { viewerOf } from '../../../features/watch/viewer';
import { requestIdentity } from '../../../lib/request-session';
import { RecordingsTab } from '../../../ui/watch/recordings-tab/recordings-tab';
import { WatchHub } from '../../../ui/watch/watch-hub/watch-hub';

export const metadata: Metadata = { title: 'Recordings' };

/** The public archive of recorded Rounds, under the Watch hub. */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  redirectUnlessLaunched('watch');
  const viewer = viewerOf(await requestIdentity());
  const query = parseRecordingsQuery(await searchParams);
  return (
    <WatchHub active="recordings" counts={countHub(watchSource)}>
      <RecordingsTab
        query={query}
        listing={listRecordings(query, viewer, watchSource)}
      />
    </WatchHub>
  );
}
