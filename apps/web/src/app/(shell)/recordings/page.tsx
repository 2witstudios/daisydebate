import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { countHub } from '../../../features/watch/list-live';
import { listRecordings } from '../../../features/watch/list-recordings';
import { parseRecordingsQuery } from '../../../features/watch/recordings-query';
import { viewerOf } from '../../../features/watch/viewer';
import { requireAccess } from '../../../lib/access';
import { RecordingsTab } from '../../../ui/watch/recordings-tab/recordings-tab';
import { WatchHub } from '../../../ui/watch/watch-hub/watch-hub';

export const metadata: Metadata = { title: 'Recordings' };

/** The guarded archive of recorded debates, under the Watch hub. */
export default async function RecordingsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const viewer = viewerOf(await requireAccess('/recordings', searchParams));
  const query = parseRecordingsQuery(await searchParams);
  return (
    <WatchHub active="recordings" counts={countHub()}>
      <RecordingsTab query={query} listing={listRecordings(query, viewer)} />
    </WatchHub>
  );
}
