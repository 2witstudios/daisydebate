import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { buildDetail } from '../../../features/leaderboard/detail';
import { buildLadder } from '../../../features/leaderboard/ladder';
import { parseLadderQuery } from '../../../features/leaderboard/query';
import { readLadder } from '../../../features/leaderboard/read-leaderboard';
import { processApp } from '../../../server/process-app';
import { requestIdentity } from '../../../lib/request-session';
import { Leaderboard } from '../../../ui/leaderboard/leaderboard';

export const metadata: Metadata = { title: 'Leaderboard' };

/** Public: anyone may read the ladder; a signed-in member also sees their line. */
export default async function LeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseLadderQuery(await searchParams);
  const identity = await requestIdentity();
  const username = identity.state === 'member' ? identity.username : null;
  const now = systemClock.now();
  const read = await readLadder(processApp().database, {
    seasonId: query.season,
    ladder: query.ladder,
    now,
    username,
    ...(identity.state === 'member' && identity.principal.actorId
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
  if (!read)
    return (
      <div className="p-6">
        <h1>Leaderboard</h1>
        <p>No season is active.</p>
      </div>
    );
  const { data, viewer } = read;
  const view = buildLadder(data, query, viewer);
  const detail =
    query.debater === null
      ? null
      : buildDetail(
          query.debater,
          data.season,
          read.debater(query.debater),
          query,
          viewer,
        );
  return (
    <Leaderboard
      view={view}
      query={query}
      now={now}
      judging={(viewer?.blinded.length ?? 0) > 0}
      detail={detail}
    />
  );
}
