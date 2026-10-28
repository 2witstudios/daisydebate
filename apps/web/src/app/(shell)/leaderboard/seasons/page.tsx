import { parseLadderQuery } from '../../../../features/leaderboard/query';
import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requestLadder } from '../../../../lib/request-session';
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
  const params = await searchParams;
  const { ladder } = parseLadderQuery(params);
  const read = await requestLadder({
    seasonId: parseSeasonsQuery(params),
    ladder,
    now,
  });
  if (!read)
    return (
      <div className="p-6">
        <h1>Seasons</h1>
        <p>No season is active.</p>
      </div>
    );
  const { data, viewer } = read;
  return <SeasonsPage view={buildSeasonsView(data, now, viewer, ladder)} />;
}
