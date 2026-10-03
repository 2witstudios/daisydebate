import { buildDetail, type DebaterDetail } from '../leaderboard/detail';
import { defaultQuery } from '../leaderboard/query';
import { readDebater, readLadder } from '../leaderboard/read-leaderboard';
import { sampleProfileExtras, type ProfileExtras } from '../../ui/mock/profile';

export type Profile = {
  readonly username: string;
  readonly me: boolean;
  readonly detail: DebaterDetail;
  readonly extras: ProfileExtras;
  /** Only the owner of a profile can edit it. */
  readonly editHref: string | null;
};

/**
 * The profile page's one data seam: a debater's public profile for the
 * current season, as seen by `viewer`. Today it reads the sample ladder and
 * sample extras; the backend read of the account and its ratings replaces
 * this function and nothing else.
 */
export function getProfile(
  username: string,
  viewer: string | null,
  now: string,
): Profile {
  const { data, viewer: ladderViewer } = readLadder(null, now, viewer);
  const detail = buildDetail(
    username,
    data.season,
    readDebater(username, data.season.id, now, viewer),
    defaultQuery,
    ladderViewer,
  );
  const me = viewer === username;
  return {
    username,
    me,
    detail,
    extras: sampleProfileExtras(username, now),
    editHref: me ? '/settings' : null,
  };
}
