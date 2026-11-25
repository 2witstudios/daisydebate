import type { Metadata } from 'next';
import { requestPricingOpen } from '../pricing/releases';
import { PremiumPage } from '../../../ui/premium/premium-page';
import { requestHoldsPremium } from './read-plan';

export const metadata: Metadata = { title: 'Daisy Premium' };

/** Public product terms; purchase admission is a separate authenticated operation. */
export default async function Premium() {
  const [pricing, holds] = await Promise.all([
    requestPricingOpen(),
    requestHoldsPremium(),
  ]);
  return <PremiumPage comparePlans={pricing} holdsPremium={holds} />;
}
