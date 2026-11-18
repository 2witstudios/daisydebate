import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { planActions } from '../../../features/pricing/plan-actions';
import { planPrices } from '../../../features/pricing/plan-prices';
import { PricingPage } from '../../../ui/pricing/pricing-page';
import { requestPlanReleases, requestPricingOpen } from './releases';

const description =
  'Debating people on Daisy Debate is free. Premium, Club, Host and League plans pay for AI practice, video and running events.';

export const metadata: Metadata = {
  title: 'Plans and pricing',
  description,
  alternates: { canonical: '/pricing' },
  openGraph: {
    type: 'website',
    siteName: 'Daisy Debate',
    title: 'Plans and pricing',
    description,
    url: '/pricing',
  },
};

/**
 * Public: every plan, readable signed out, once `pricing-page` opens (until
 * then it does not exist). Each plan's action opens with the flag that owns
 * its destination (checkout, the host home, Club seats, League requests);
 * until then its card says "Coming soon".
 */
export default async function Pricing() {
  const [open, releases] = await Promise.all([
    requestPricingOpen(),
    requestPlanReleases(),
  ]);
  if (!open) notFound();
  return <PricingPage prices={planPrices} actions={planActions(releases)} />;
}
