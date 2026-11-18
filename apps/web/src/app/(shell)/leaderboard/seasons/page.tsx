import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import {
  requestLadder,
  requestMemberDivision,
} from '../../../../lib/request-session';
import { boardLadder } from '../../../../features/leaderboard/board-ladder';
import { parseLadderQuery } from '../../../../features/leaderboard/query';
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
  const query = parseLadderQuery(params);
  const read = await requestLadder({
    seasonId: parseSeasonsQuery(params),
    ladder: boardLadder(
      query.division,
      // A public page: a failed division read falls back to Open.
      await requestMemberDivision().catch(() => null),
    ),
    now,
  });
  const view =
    read && buildSeasonsView(read.data, read.ladder, now, read.viewer);
  return <SeasonsPage view={view} />;
}
