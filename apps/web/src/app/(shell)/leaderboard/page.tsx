import { ratingDivisionForAgeRule } from '@daisy/protocol/ladder';
import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { buildDetail } from '../../../features/leaderboard/detail';
import { buildLadder } from '../../../features/leaderboard/ladder';
import { boardLadder } from '../../../features/leaderboard/board-ladder';
import {
  lobbyHref,
  parseLadderQuery,
} from '../../../features/leaderboard/query';
import {
  requestLadder,
  requestOfficialStandingLobbies,
  requestLandingLobby,
} from '../../../lib/request-session';
import { Segmented } from '../../../ui/components/segmented/segmented';
import { Leaderboard } from '../../../ui/leaderboard/leaderboard';

export const metadata: Metadata = { title: 'Leaderboard' };

/** Public: anyone may read the ladder; a signed-in member also sees their line. */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseLadderQuery(await searchParams);
  const now = systemClock.now();
  const available = await requestOfficialStandingLobbies();
  const landingId =
    query.lobby || query.division ? null : (await requestLandingLobby())?.id;
  const chosen = query.lobby
    ? available.find(({ id }) => id === query.lobby)
    : query.division === null
      ? available.find(({ id }) => id === landingId)
      : available.find(
          ({ ageRule }) => ratingDivisionForAgeRule(ageRule) === query.division,
        );
  const lobby = query.lobby ? chosen : (chosen ?? available[0]);
  const read =
    lobby &&
    (await requestLadder({
      lobbyId: lobby.id,
      seasonId: query.season,
      ladder: boardLadder(ratingDivisionForAgeRule(lobby.ageRule), null),
      now,
    }));
  if (!read)
    return (
      <div className="p-6">
        <h1>Leaderboard</h1>
        <p>No season is active.</p>
        <Segmented
          label="Lobby"
          wrap
          segments={available.map(({ id, name }) => ({
            label: name,
            href: lobbyHref(query, id),
            selected: lobby?.id === id,
          }))}
        />
      </div>
    );
  const { data, viewer } = read;
  const selected = { ...query, lobby: lobby.id, division: null };
  const view = buildLadder(data, selected, viewer);
  const detail =
    query.debater === null
      ? null
      : buildDetail(
          query.debater,
          data.season,
          read.debater(query.debater),
          selected,
          viewer,
        );
  return (
    <Leaderboard
      ladder={read.ladder}
      view={view}
      query={selected}
      lobbies={available.map(({ id, name }) => ({
        id,
        name,
      }))}
      now={now}
      judging={(viewer?.blinded.length ?? 0) > 0}
      detail={detail}
    />
  );
}
