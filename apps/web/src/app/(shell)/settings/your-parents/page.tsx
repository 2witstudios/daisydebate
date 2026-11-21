import type { SearchParams } from '../../../../features/access/decision';
import { requireAccess } from '../../../../lib/access';
import { FamilySettings } from '../parental-controls/family-settings';

export const metadata = { title: 'Your parents' };

export default async function YourParentsPage({
  searchParams,
}: {
  readonly searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/settings/your-parents', searchParams);
  return <FamilySettings role="child" />;
}
