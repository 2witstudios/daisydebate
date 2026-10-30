import { watchConsent } from '../../src/features/analytics/consent-sync';
import {
  syncAnalytics,
  trackClient,
  stopAnalytics,
} from '../../src/features/analytics/client-adapter';

export type AnalyticsBrowser = {
  readonly watchConsent: typeof watchConsent;
  readonly syncAnalytics: typeof syncAnalytics;
  readonly trackClient: typeof trackClient;
  readonly stopAnalytics: typeof stopAnalytics;
};
Object.assign(window, {
  daisyAnalyticsTest: {
    syncAnalytics,
    trackClient,
    stopAnalytics,
    watchConsent,
  },
});
