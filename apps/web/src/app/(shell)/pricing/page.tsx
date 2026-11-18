import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { planActions } from '../../../features/pricing/plan-actions';
import { planPrices } from '../../../features/pricing/plan-prices';
import { requestReleaseEnabled } from '../../../lib/request-session';
import { PricingPage } from '../../../ui/pricing/pricing-page';

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
 * until then its card says "Coming soon". Flags are read for no
 * account: the page is the same for every viewer.
 */
export default async function Pricing() {
  const [pricing, premiumCheckout, hostTiers, clubSeats, leagueRequests] =
    await Promise.all([
      requestReleaseEnabled('pricing-page', null),
      requestReleaseEnabled('premium-checkout', null),
      requestReleaseEnabled('host-tiers', null),
      requestReleaseEnabled('club-seats', null),
      requestReleaseEnabled('league-requests', null),
    ]);
  if (!pricing) notFound();
  return (
    <PricingPage
      prices={planPrices}
      actions={planActions({
        premiumCheckout,
        hostTiers,
        clubSeats,
        leagueRequests,
      })}
    />
  );
}
