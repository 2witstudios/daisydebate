import { spectatorClockAt } from '../spectating/spectator-clock';
import { readUnlessRefused } from '../spectating/refused-read';
import { followingOf } from './following';
import { type HubCounts } from './hub-counts';
import { liveRoundsOf } from './list-live';
import { type LiveQuery } from './live-query';
import { recordingReads } from '../recording/composition';
import { requestApp } from '../../lib/page-reads';

/** One page of the real Live listing. */
export const requestLiveListing = (query: LiveQuery) =>
  readUnlessRefused(
    () => requestApp().liveReads.listing(query),
    'refused' as const,
  );

/** The newest live Rounds, for the home page. */
export const requestLeadingLive = () =>
  readUnlessRefused(() => requestApp().liveReads.leading(), []);

/** The live Round of each named debater, for a profile or the Friends list. */
export const requestLiveRoundsOf = (usernames: readonly string[]) =>
  readUnlessRefused(
    () =>
      liveRoundsOf(requestApp().database, {
        usernames,
        now: requestApp().clock.now(),
      }),
    new Map(),
  );

const FOLLOWING_ROWS = 50;

const RECENTLY_WATCHED_ROWS = 10;

/** The Following tab for one account: who it follows, who is live, what it watched. */
export const requestFollowing = async (userId: string, lobbyId: string) => {
  const { database, clock } = requestApp();
  const now = clock.now();
  const [usernames, history] = await Promise.all([
    database.listFollowedDebaters({
      followerUserId: userId,
      limit: FOLLOWING_ROWS,
    }),
    database.listWatchHistory({
      userId,
      clock: spectatorClockAt(now),
      limit: RECENTLY_WATCHED_ROWS,
    }),
  ]);
  const live = await liveRoundsOf(database, { usernames, now, lobbyId });
  return followingOf({ usernames, live, history });
};

/** The running Youth Rounds a member's students debate in (ADR 0155), for the Lobby's live rows. */
export const requestStudentRoundIds = (member: { readonly userId: string }) =>
  requestApp().studentRoundIds(member);

/**
 * "Your students, live" (ADR 0155): the running Youth Rounds the member's
 * students debate in, each read as the member, so only those they may watch
 * appear. Empty for anyone linked to no youth debater.
 */
export const requestStudentsLive = (member: {
  readonly userId: string;
  readonly actorId: string;
  readonly lobbyId?: string;
}) => requestApp().studentsLive(member);

/** The numbers on the Watch tabs. */
export const requestHubCounts = async (
  lobbyId?: string,
): Promise<HubCounts> => {
  const app = requestApp();
  const clock = spectatorClockAt(app.clock.now());
  const [live, recordings] = await Promise.all([
    readUnlessRefused(() => app.liveReads.count(lobbyId), 0),
    recordingReads(app).archive.countPublicArchive({ clock }),
  ]);
  return { live, recordings };
};

/** Whether this account follows that debater; null when it cannot. */
export const requestDebaterFollow = (
  followerUserId: string,
  username: string,
) => requestApp().database.readDebaterFollow({ followerUserId, username });
