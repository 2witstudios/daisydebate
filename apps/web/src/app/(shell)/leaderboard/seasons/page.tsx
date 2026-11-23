import { ratingDivisionForAgeRule } from '@daisy/protocol/ladder';
import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requestLadder } from '../../../../features/leaderboard/page-reads';
import { requestOfficialRatingLadders } from '../../../../features/ratings/page-reads';
import { requestLandingLobby } from '../../../../features/lobby/page-reads';
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
  const available = await requestOfficialRatingLadders();
  const landingId =
    query.lobby || query.division ? null : (await requestLandingLobby())?.id;
  const chosen = query.lobby
    ? available.find(({ lobbyId }) => lobbyId === query.lobby)
    : query.division === null
      ? available.find(({ lobbyId }) => lobbyId === landingId)
      : available.find(
          ({ ageRule }) => ratingDivisionForAgeRule(ageRule) === query.division,
        );
  const lobby = query.lobby ? chosen : (chosen ?? available[0]);
  const read =
    lobby &&
    (await requestLadder({
      lobbyId: lobby.lobbyId,
      seasonId: parseSeasonsQuery(params),
      ladder: boardLadder(ratingDivisionForAgeRule(lobby.ageRule), null),
      now,
    }));
  const view =
    read &&
    buildSeasonsView(read.data, read.ladder, now, read.viewer, lobby.lobbyId);
  return <SeasonsPage view={view ?? null} />;
}
