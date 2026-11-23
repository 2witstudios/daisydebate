import { createAppError } from '@daisy/errors';
import { readMemberStandings } from './read-member';
import { readRoundRatings } from './read-round';
import { cache } from 'react';
import { type RatingDivision } from '@daisy/protocol/ladder';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/** The ladder division this render's account is on when it is in `state`; null otherwise or without a valid age record. */
const divisionWhen = async (
  state: 'member' | 'provisional',
): Promise<RatingDivision | null> => {
  const identity = await requestIdentity();
  if (identity.state !== state) return null;
  return requestApp().database.readMemberDivision(identity.principal.userId);
};

/**
 * This render's member's ladder division (ADR 0147), so a page names their
 * ladder and offers ranked seats on it. Null for anyone else and for a member
 * with no age record. It only shapes the page: every ranked command decides
 * again under its fence.
 */
export const requestMemberDivision = cache(() => divisionWhen('member'));

export const requestOfficialRatingLadders = cache(() =>
  requestApp().database.listOfficialRatingLadders(),
);

export async function requestMemberStandings(username: string) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const app = requestApp();
  return readMemberStandings(app.database, {
    username,
    now: app.clock.now(),
    ...(identity.state === 'member'
      ? { viewerActorId: identity.principal.actorId }
      : {}),
  });
}

/** The renderer supplies a Round it already read under its audience policy. */
export async function requestRoundRatings(
  round: import('@daisy/protocol/round-view').RoundView,
) {
  const identity = await requestIdentity();
  if (identity.state === 'unavailable') throw createAppError('INFRASTRUCTURE');
  const app = requestApp();
  return readRoundRatings(app.database, {
    round,
    now: app.clock.now(),
    viewerActorId:
      identity.state === 'member' ? identity.principal.actorId : null,
  });
}
