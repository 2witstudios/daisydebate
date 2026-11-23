import { followOfferedTo } from '../../../../features/following/follow-offer';
import {
  reportFromPageAction,
  setDebaterFollowAction,
} from '../../audience/actions';
import { FollowButton } from '../../../../ui/following/follow-button';
import { requestDebaterFollow } from '../../../../features/watch/page-reads';
import { requestMemberStandings } from '../../../../features/ratings/page-reads';
import { requestMessageOffer } from '../../../../features/messaging/page-reads';
import { MemberStandings } from '../../../../ui/ranked/member-standings';
import { profileLadders } from '../../../../features/profile/profile-ladders';
import type { RatingDivision } from '@daisy/protocol/ladder';
import { parseUsername } from '@daisy/auth';
import { systemId } from '@daisy/clock';
import { matchHistoryQuerySchema } from '@daisy/protocol/member-profile';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { ProfilePage } from '../../../../ui/profile/profile-page/profile-page';
import { requestIdentity } from '../../../../lib/page-reads';
import { requestLiveRoundsOf } from '../../../../features/watch/page-reads';
import { requestMemberDivision } from '../../../../features/ratings/page-reads';
import { requestProfileChallengeModes } from '../../../../features/challenges/page-reads';
import {
  requestSeasonHistory,
  requestMemberProfile,
} from '../../../../features/profile/page-reads';
import { ProfileFriendActions } from '../../../../ui/friends/profile-friend-actions';
import { relationTo } from '../../../../ui/friends/friends';
import { friendAction } from '../../friends/actions';
import { blockAction } from '../../contacts/actions';
import { reportAction } from '../../reports/actions';
import { sendChallengeAction } from '../../challenges/actions';
import { ProfilePersonActions } from '../../../../ui/people/profile-person-actions';
import { readFriends } from '../../friends/read-friends';
import { MessageUserButton } from '../../../../ui/messaging/message-user-button';
import { createConversationAction } from '../../messages/new/actions';
import { reportNotice } from '../../../../features/content-moderation/submit-report';
import { ProfileReports } from '../../../../ui/profile/profile-reports/profile-reports';

export const metadata: Metadata = { title: 'Profile' };

/** Public: anyone may read a member's profile; only its owner sees every Round. */
export default async function ProfileRoute({
  params,
  searchParams,
}: {
  readonly params: Promise<{ username: string }>;
  readonly searchParams: Promise<SearchParams>;
}) {
  const { username } = await params;
  const name = parseUsername(username);
  if (!name.ok) notFound();
  const raw = await searchParams;
  const query = matchHistoryQuerySchema.safeParse(
    typeof raw.before === 'string' ? { before: raw.before } : {},
  );
  if (!query.success) notFound();
  // Null: no member, live or closed, holds the name, or the cursor names no
  // Round the viewer may list. Either way there is no such page.
  const profile = await requestMemberProfile(name.username, query.data);
  if (profile === null) notFound();
  const [standings, seasonHistory, ownDivision] = await Promise.all([
    requestMemberStandings(profile.username),
    requestSeasonHistory(profile.username),
    requestMemberDivision(),
  ]);
  const live = await requestLiveRoundsOf([profile.username]);
  const toward = !profile.me && !profile.closed;
  const member = (await requestIdentity()).state === 'member';
  return (
    <ProfilePage
      ratings={
        <MemberStandings
          standings={profileLadders(
            standings,
            ownLadderOn(profile, ownDivision),
          )}
          seasonHistory={seasonHistory}
        />
      }
      profile={profile}
      liveRound={live.get(profile.username) ?? null}
      paged={query.data.before !== undefined}
      reports={
        toward && member ? (
          <ProfileReports
            shown={profile.shown}
            notice={reportNotice(raw.report)}
            action={reportFromPageAction.bind(
              null,
              `/profile/${profile.username}`,
            )}
          />
        ) : null
      }
      actions={toward ? await friendActionsFor(profile.username) : null}
    />
  );
}

/** The viewer's own ladder shows unrated on their own profile only. */
const ownLadderOn = (
  profile: { readonly me: boolean },
  division: RatingDivision | null,
): RatingDivision | null => (profile.me ? division : null);

/** Following needs an account, not admission; the block rule lives in the store. */
async function ProfileFollow({ username }: { readonly username: string }) {
  const identity = await requestIdentity();
  if (!followOfferedTo(identity)) return null;
  const follow = await requestDebaterFollow(
    identity.principal.userId,
    username,
  );
  if (!follow) return null;
  return (
    <FollowButton
      username={username}
      following={follow.following}
      action={setDebaterFollowAction.bind(null, {
        username,
        state: follow.following ? 'not_following' : 'following',
        returnTo: `/profile/${username}`,
      })}
    />
  );
}

/**
 * Message toward someone else, as the DM rule would answer a request now
 * (decision 90): the button, or, where only a friendship opens one (an
 * adult toward a minor, or someone taking requests from friends only),
 * the reason to Add friend instead. The two read the same, so no age shows.
 */
async function ProfileMessage({ username }: { readonly username: string }) {
  const offer = await requestMessageOffer(username);
  if (offer === 'befriend')
    return (
      <p className="text-sm text-ink-muted" data-message-offer="befriend">
        Add @{username} as a friend to send them a message.
      </p>
    );
  if (offer === 'none') return null;
  return (
    <MessageUserButton
      username={username}
      requestId={systemId.next()}
      action={createConversationAction.bind(null, 'dm')}
    />
  );
}

/**
 * A member's Add friend, Message, Challenge, Report and Block, toward someone else;
 * nothing for a visitor. Message goes through the ordinary DM request, under
 * the DM rule.
 */
async function friendActionsFor(username: string) {
  if ((await requestIdentity()).state !== 'member') return null;
  const [list, modes] = await Promise.all([
    readFriends(),
    requestProfileChallengeModes(username),
  ]);
  return (
    <>
      {list ? (
        <ProfileFriendActions
          username={username}
          relation={relationTo(list, username)}
          friendAction={friendAction}
        />
      ) : null}
      <ProfileFollow username={username} />
      <ProfileMessage username={username} />
      <ProfilePersonActions
        username={username}
        modes={modes}
        actions={{
          sendChallenge: sendChallengeAction,
          report: reportAction,
          block: blockAction,
        }}
      />
    </>
  );
}
