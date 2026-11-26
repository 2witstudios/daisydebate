import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { planPrices } from '../../../features/pricing/plan-prices';
import { TabPage } from '../../../ui/marketing/tab-page';
import { requestAudienceLinks } from '../audience-links';

const description =
  'Daisy Tab pairs each round, collects every ballot and keeps the standings for your debate tournament.';

export const metadata: Metadata = {
  title: 'Daisy Tab for tournaments',
  description,
  alternates: { canonical: '/tab' },
};

/** Public: Daisy Tab for a tournament director, while hosting is released. */
export default async function Tab() {
  const links = await requestAudienceLinks();
  if (links.tab === null) notFound();
  return <TabPage prices={planPrices} links={links} />;
}
