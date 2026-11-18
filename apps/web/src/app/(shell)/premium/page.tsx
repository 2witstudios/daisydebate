import type { Metadata } from 'next';
import { requestReleaseEnabled } from '../../../lib/request-session';
import { PremiumPage } from '../../../ui/premium/premium-page';

export const metadata: Metadata = { title: 'Daisy Premium' };

/** Public product terms; purchase admission is a separate authenticated operation. */
export default async function Premium() {
  const pricing = await requestReleaseEnabled('pricing-page', null);
  return <PremiumPage comparePlans={pricing} />;
}
