import type { Metadata } from 'next';
import { RouteShell } from '../../../ui/route-shell';

export const metadata: Metadata = { title: 'Profile' };

export default async function ProfilePage({
  params,
}: {
  params: Promise<{ username: string }>;
}) {
  const { username } = await params;
  return (
    <RouteShell
      title={`@${username}`}
      lede="Public debate profile."
      planned={[
        'Rating history per format',
        'Debate and tournament history',
        'Achievements and verified status',
      ]}
    />
  );
}
