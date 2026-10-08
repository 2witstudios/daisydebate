import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { readingPace } from '../../../../features/prep/cards/get-card';
import { roomPanelView } from '../../../../features/prep/room-panel';
import { parseRoomPanelQuery } from '../../../../features/prep/room-panel-query';
import { requireAccess } from '../../../../lib/access';
import { InDebatePage } from '../../../../ui/prep/in-debate-page/in-debate-page';

export const metadata: Metadata = { title: 'Your prep in a debate' };

/** The prep panel beside a room; the panel is yours alone. */
export default async function InDebateRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep/in-debate', searchParams);
  const now = systemClock.now();
  const query = parseRoomPanelQuery(await searchParams);
  return (
    <InDebatePage
      view={roomPanelView(query, readingPace(), now)}
      loadedAt={now.slice(11, 16)}
    />
  );
}
