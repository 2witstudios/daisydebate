import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { planPrices } from '../../../features/pricing/plan-prices';
import { ParentsPage } from '../../../ui/marketing/parents-page';
import { requestAudienceLinks } from '../audience-links';

const description =
  'Introduce your kid to debate: live rounds from home against students their age, feedback they can use, and guardrails you set.';

export const metadata: Metadata = {
  title: 'Daisy for parents',
  description,
  alternates: { canonical: '/parents' },
};

/**
 * Public: Daisy for a parent. Its one action is signing a child up, so the
 * page exists while parental controls are released.
 */
export default async function Parents() {
  const links = await requestAudienceLinks();
  if (links.parents === null) notFound();
  return <ParentsPage prices={planPrices} links={links} />;
}
