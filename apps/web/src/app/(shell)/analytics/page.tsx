import type { Metadata } from 'next';
import { requestAnalytics } from '../../../lib/request-session';
import { ConsentControls } from '../../../ui/analytics/consent-controls';
export const metadata: Metadata = { title: 'Analytics preferences' };
export default async function AnalyticsPreferences() {
  const analytics = await requestAnalytics();
  return (
    <div className="mx-auto flex max-w-reading flex-col gap-6 p-6">
      <h1 className="font-display text-3xl font-bold text-ink">
        Analytics preferences
      </h1>
      {analytics.available.analytics ? (
        <ConsentControls {...analytics} />
      ) : (
        <p>Optional analytics is not enabled for this deployment.</p>
      )}
    </div>
  );
}
