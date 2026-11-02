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
  return (
    <SeasonsPage
      view={read && buildSeasonsView(read.data, now, read.viewer, ladder)}
      resolutions={resolutions}
    />
  );
}
