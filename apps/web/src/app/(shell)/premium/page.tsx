import type { Metadata } from 'next';
import { requestPricingOpen } from '../pricing/releases';
import { PremiumPage } from '../../../ui/premium/premium-page';

export const metadata: Metadata = { title: 'Daisy Premium' };

/** Public product terms; purchase admission is a separate authenticated operation. */
export default async function Premium() {
  const pricing = await requestPricingOpen();
  return <PremiumPage comparePlans={pricing} />;
}
