import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readSetup } from '../../../../../../features/tab/setup';
import { readStandings } from '../../../../../../features/tab/standings';
import { HostStandings } from '../../../../../../ui/tab/standings/host-standings';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Standings' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.standings(slug));
  const rail = readTimelineRail(slug, scene);
  const table = readStandings(slug, null, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || table === null || setup === null) notFound();
  return <HostStandings rail={rail} event={setup.event} table={table} />;
}
