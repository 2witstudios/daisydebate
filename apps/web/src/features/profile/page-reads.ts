import type { PublicProfileCard } from '@daisy/db/stores/profiles';
import { createAppError } from '@daisy/errors';
import { readSeasonHistory } from './season-history';
import { headers } from 'next/headers';
import { type MatchHistoryQuery } from '@daisy/protocol/member-profile';
import { CLIENT_ID_HASH_HEADER } from '../../server/client-ip';
import { readProfile, type ProfileView } from './read-profile';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/**
 * A member's profile as this render's viewer may see it, read in the server
 * render so a link followed from another site renders instead of meeting an
 * API's cross-site read check. The profile feature owns the read and its
 * authorization and budgets; this process entry supplies the trusted client hash
 * and the shared Redis limiter as well as the app's database.
 */
export const requestMemberProfile = async (
  username: string,
  query: MatchHistoryQuery,
): Promise<ProfileView | null> =>
  readProfile(
    { store: requestApp().database, limiter: requestApp().limiter },
    {
      clientId: (await headers()).get(CLIENT_ID_HASH_HEADER),
      identity: await requestIdentity(),
      username,
      query,
      now: requestApp().clock.now(),
    },
  );

/**
 * The member's own display name and published photo, for the shell's account
 * menu (ADR 0143): the one public read lists use, for one actor.
 */
export const requestOwnProfileCard = async (
  actorId: string,
): Promise<PublicProfileCard> =>
  (await requestApp().database.readPublicProfileCards([actorId])).get(
    actorId,
  ) ?? { displayName: null, photoId: null };

/** A member's closed seasons per ladder, newest first, for their profile. */
export async function requestSeasonHistory(username: string) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const app = requestApp();
  return readSeasonHistory(app.database, {
    username,
    now: app.clock.now(),
    ...(identity.state === 'member'
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
}
