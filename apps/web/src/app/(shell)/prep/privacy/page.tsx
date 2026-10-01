import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { PrivacyPage } from '../../../../ui/prep/privacy-page/privacy-page';

export const metadata: Metadata = { title: 'What stays private' };

export default async function PrepPrivacyRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/prep/privacy', searchParams);
  return <PrivacyPage />;
}
