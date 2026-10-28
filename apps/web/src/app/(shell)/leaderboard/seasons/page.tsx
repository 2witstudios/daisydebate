import { processApp } from '../../../../server/process-app';
import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { readLadder } from '../../../../features/leaderboard/read-leaderboard';
import {
  buildSeasonsView,
  parseSeasonsQuery,
} from '../../../../features/leaderboard/seasons';
import { SeasonsPage } from '../../../../ui/leaderboard/seasons-page/seasons-page';

export const metadata: Metadata = { title: 'Seasons' };

/** Public: the season overview, champion, snapshot and how rating works. */
export default async function SeasonsRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const now = systemClock.now();
  const read = await readLadder(processApp().database, {
    seasonId: parseSeasonsQuery(await searchParams),
    ladder: 'freestyle',
    now,
    username: null,
  });
  if (!read)
    return (
      <div className="p-6">
        <h1>Seasons</h1>
        <p>No season is active.</p>
      </div>
    );
  const { data } = read;
  return <SeasonsPage view={buildSeasonsView(data, now)} />;
}
