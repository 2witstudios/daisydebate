import { AnalyticsClient } from '../ui/analytics/analytics-client';
import { ConsentBanner } from '../ui/analytics/consent-banner';
import { SessionRefresh } from '../ui/auth/session-refresh/session-refresh';
import { DocumentDraftPrivacy } from '../ui/documents/document-draft-privacy';
import {
  requestAnalytics,
  requestIdentity,
  sessionRefreshDueNow,
} from '../lib/request-session';

/**
 * What the app adds around a page because a person is using it (ADR 0123):
 * draft privacy, the session refresh, analytics and the consent banner. Each
 * visitor route group's layout renders this; the root layout and the
 * `(stage)` group never do, so a recorder never meets a prompt it cannot
 * answer and no recording carries one. The boundary scan enforces it.
 */
export async function VisitorFeatures() {
  const refreshSession = await sessionRefreshDueNow();
  const analytics = await requestAnalytics();
  const identity = await requestIdentity();
  const draftsPrincipal =
    identity.state === 'unavailable'
      ? undefined
      : identity.state === 'anonymous'
        ? null
        : identity.principal.userId;
  return (
    <>
      <DocumentDraftPrivacy principalId={draftsPrincipal} />
      {refreshSession ? <SessionRefresh /> : null}
      {analytics.capture ? (
        <>
          <AnalyticsClient
            {...analytics.capture}
            consent={analytics.choice.consent}
          />
          <div className="fixed inset-x-4 bottom-4 z-50 mx-auto max-w-reading">
            <ConsentBanner
              consent={analytics.choice.consent}
              available={analytics.available}
            />
          </div>
        </>
      ) : null}
    </>
  );
}
