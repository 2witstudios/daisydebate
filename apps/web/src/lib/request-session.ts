import { cache } from 'react';
import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import type { MatchHistoryQuery, MemberProfile } from '@daisy/protocol';
import type { OnboardingAnswers } from '../features/onboarding/answers';
import { readProfile } from '../features/profile/read-profile';
import { sessionRefreshDue } from '../features/auth/sessions/session-policy';
import { processApp } from '../server/process-app';
import { resolveSession } from './identity';

/**
 * This request's session, resolved once: the root layout and the page it
 * wraps render in the same request, and React's per-request cache makes
 * them share one durable session read.
 */
const requestSession = cache(async () =>
  resolveSession(processApp().auth(), await headers()),
);

/** Who is asking in this server-component render. */
export const requestIdentity = async (): Promise<Identity> =>
  (await requestSession()).identity;

/**
 * Whether the browser should slide this request's session now: only for a
 * live signed-in session past `updateAge`, so a signed-in browser calls the
 * rate-limited `get-session` endpoint about once a day, not per page load.
 */
export const sessionRefreshDueNow = async (): Promise<boolean> => {
  const { sessionExpiresAt } = await requestSession();
  return (
    sessionExpiresAt !== null &&
    sessionRefreshDue(sessionExpiresAt, processApp().clock.now())
  );
};

/**
 * The signed-in member's own onboarding answers, read once for this
 * server-component render; null for anyone who is not a member. The id is
 * the session's, never one the request names.
 */
export const requestOnboardingAnswers = cache(
  async (): Promise<OnboardingAnswers | null> => {
    const identity = await requestIdentity();
    if (identity.state !== 'member') return null;
    return processApp().database.readOnboarding(identity.principal.userId);
  },
);

/** Whether this render's account without a username has answered the age step. */
export const requestHasRecordedAge = cache(async (): Promise<boolean> => {
  const identity = await requestIdentity();
  if (identity.state !== 'provisional') return false;
  return processApp().database.hasRecordedAge(identity.principal.userId);
});

/**
 * A member's profile as this render's viewer may see it, read in the server
 * render so a link followed from another site renders instead of meeting an
 * API's cross-site read check. The profile feature owns the read and its
 * authorization; this process entry only hands it the app's database.
 */
export const requestMemberProfile = async (
  username: string,
  query: MatchHistoryQuery,
): Promise<MemberProfile | null> =>
  readProfile(processApp().database, {
    identity: await requestIdentity(),
    username,
    query,
  });
