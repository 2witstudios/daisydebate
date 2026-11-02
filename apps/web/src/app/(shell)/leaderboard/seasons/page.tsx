import { parseLadderQuery } from '../../../../features/leaderboard/query';
import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import {
  requestLadder,
  requestPublishedResolutions,
} from '../../../../lib/request-session';
import {
  buildSeasonsView,
  parseSeasonsQuery,
} from '../../../../features/leaderboard/seasons';
import { SeasonResolutions } from '../../../../ui/leaderboard/season-resolutions/season-resolutions';
import { SeasonsPage } from '../../../../ui/leaderboard/seasons-page/seasons-page';

export const metadata: Metadata = { title: 'Seasons' };

/** Public: the resolutions, season overview, champion, snapshot and how rating works. */
export default async function SeasonsRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const now = systemClock.now();
  const params = await searchParams;
  const { ladder } = parseLadderQuery(params);
  const [read, resolutions] = await Promise.all([
    requestLadder({ seasonId: parseSeasonsQuery(params), ladder, now }),
    requestPublishedResolutions(),
  ]);
  if (!read)
    return (
      <div className="flex flex-col gap-5 p-6">
        <h1>Seasons</h1>
        <p>No season is active.</p>
        <SeasonResolutions resolutions={resolutions} />
      </div>
    );
  const { data, viewer } = read;
  return (
    <SeasonsPage
      view={buildSeasonsView(data, now, viewer, ladder)}
      resolutions={resolutions}
    />
  );
}
