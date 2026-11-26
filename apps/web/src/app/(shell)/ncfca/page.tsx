import type { Metadata } from 'next';
import { ncfcaTimes } from '../../../features/marketing/ncfca-times';
import { planPrices } from '../../../features/pricing/plan-prices';
import { NcfcaPage } from '../../../ui/marketing/ncfca-page';
import { requestAudienceLinks } from '../audience-links';

const description =
  'Practice rounds between NCFCA tournaments: Lincoln-Douglas and Team Policy from home, with a written ballot back. Not affiliated with NCFCA.';

export const metadata: Metadata = {
  title: 'Daisy for NCFCA families',
  description,
  alternates: { canonical: '/ncfca' },
};

/** Public: Daisy for an NCFCA family, readable signed out. */
export default async function Ncfca() {
  return (
    <NcfcaPage
      times={ncfcaTimes()}
      prices={planPrices}
      links={await requestAudienceLinks()}
    />
  );
}
