import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { FamilySettings } from './family-settings';

export const metadata = { title: 'Parental controls' };

export default async function ParentalControlsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings/parental-controls', searchParams);
  return <FamilySettings role="adult" />;
}
