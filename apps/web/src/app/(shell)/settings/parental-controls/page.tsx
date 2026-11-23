import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../features/access/page-access';
import { FamilySettings } from './family-settings';

export const metadata = { title: 'Parental controls' };

export default async function ParentalControlsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings/parental-controls', searchParams);
  const closed = (await searchParams)['childAccount'] === 'closed';
  return <FamilySettings role="adult" childAccountClosed={closed} />;
}
