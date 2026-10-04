import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { requireAccess } from '../../../lib/access';
import { RouteShell } from '../../ui/route-shell';

export const metadata: Metadata = { title: 'Play' };

export default async function PlayPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  await requireAccess('/play', searchParams);
  return <RouteShell title="Play" />;
}
