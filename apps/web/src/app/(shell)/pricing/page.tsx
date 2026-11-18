import type { Metadata } from 'next';
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
 * Public: every plan, readable signed out. Club and League open with their
 * release flags; until then their cards say "Coming soon". Flags are read
 * for no account: the page is the same for every viewer.
 */
export default async function Pricing() {
  const [clubSeats, leagueRequests] = await Promise.all([
    requestReleaseEnabled('club-seats', null),
    requestReleaseEnabled('league-requests', null),
  ]);
  return (
    <PricingPage
      prices={planPrices}
      actions={planActions({ clubSeats, leagueRequests })}
    />
  );
}
