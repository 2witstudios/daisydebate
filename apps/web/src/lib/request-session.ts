import { cache } from 'react';
import { headers } from 'next/headers';
import type { Identity } from '@daisy/auth';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import type { MatchHistoryQuery, MemberProfile } from '@daisy/protocol';
import type { OnboardingAnswers } from '../features/onboarding/answers';
import { CLIENT_ID_HASH_HEADER } from '../features/auth/abuse/client-ip';
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
 * Whether this render's member may be asked the optional onboarding
 * questions: their canonical age fact admits it (16 or over, ISSUE-645).
 * False for anyone else. A page only skips the questions on it; every
 * answer's write decides again under the account fence.
 */
export const requestOptionalAnswersAdmitted = cache(
  async (): Promise<boolean> => {
    const identity = await requestIdentity();
    if (identity.state !== 'member' || identity.principal.actorId === null)
      return false;
    const app = processApp();
    return app.database.optionalAnswersAdmitted({
      userId: identity.principal.userId,
      actorId: identity.principal.actorId,
      now: app.clock.now(),
      admits: admitsOptionalAnswers,
    });
  },
);

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
): Promise<MemberProfile | null> =>
  readProfile(
    { store: processApp().database, limiter: processApp().auth().limiter },
    {
      clientId: (await headers()).get(CLIENT_ID_HASH_HEADER),
      identity: await requestIdentity(),
      username,
      query,
    },
  );
