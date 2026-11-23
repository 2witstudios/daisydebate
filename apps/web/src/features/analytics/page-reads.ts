import { cookies } from 'next/headers';
import { analyticsConfiguration } from './config';
import { CONSENT_COOKIE, parseConsent } from './consent';
import { cache } from 'react';
import { readViewerAnalytics } from './viewer-analytics';
import { requestApp, requestIdentity } from '../../lib/page-reads';

/** Public adapter config only; management credentials never enter a rendered prop. */
export const requestAnalytics = cache(async () => {
  const app = requestApp();
  return readViewerAnalytics({
    config: analyticsConfiguration(app.config),
    identity: await requestIdentity(),
    cookie: parseConsent((await cookies()).get(CONSENT_COOKIE)?.value),
    readConsent: (userId) => app.database.readAnalyticsConsent(userId),
  });
});
