import { cache } from 'react';
import { admitsOptionalAnswers } from '@daisy/auth/account-age';
import { type OnboardingAnswers } from './answers';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/**
 * The signed-in account's own onboarding answers, read once for this
 * server-component render; null for anyone who cannot onboard: no claimed
 * username, or a restricted account.
 * Waitlisted accounts onboard too (ADR 0075). The id is the session's,
 * never one the request names.
 */
export const requestOnboardingAnswers = cache(
  async (): Promise<OnboardingAnswers | null> => {
    const identity = await requestIdentity();
    if (identity.state !== 'member' && identity.state !== 'waitlisted')
      return null;
    return requestApp().database.readOnboarding(identity.principal.userId);
  },
);

/**
 * Whether this render's member may be asked the optional onboarding
 * questions: their canonical age fact admits it (13 or over, ISSUE-645, decision 88).
 * False for anyone else; a waitlisted account onboards before approval. A page only skips the questions on it; every
 * answer's write decides again under the account fence.
 */
export const requestOptionalAnswersAdmitted = cache(
  async (): Promise<boolean> => {
    const identity = await requestIdentity();
    // A waitlisted account onboards before approval (ADR 0075).
    if (identity.state !== 'member' && identity.state !== 'waitlisted')
      return false;
    const app = requestApp();
    return app.database.optionalAnswersAdmitted({
      userId: identity.principal.userId,
      actorId: identity.principal.actorId,
      now: app.clock.now(),
      admits: admitsOptionalAnswers,
    });
  },
);
