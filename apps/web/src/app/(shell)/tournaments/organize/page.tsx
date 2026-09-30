import type { Metadata } from 'next';
import type { SearchParams } from '../../../../features/access/decision';
import { getOrganizeDashboard } from '../../../../features/tournaments/organize-dashboard';
import { requireAccess } from '../../../../lib/access';
import { DashboardPage } from '../../../../ui/tournaments/organize/dashboard-page';

export const metadata: Metadata = { title: 'Organize' };

/** Any signed-in organizer; a participant-app surface, not an admin one. */
export default async function OrganizeRoute({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/tournaments/organize', searchParams);
  return <DashboardPage dashboard={getOrganizeDashboard()} />;
}
