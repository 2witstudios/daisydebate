import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireGrant } from '../../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readSetup } from '../../../../../../../../features/tab/sample/read-setup';
import { readStandings } from '../../../../../../../../features/tab/sample/read-standings';
import { readTimelineRail } from '../../../../../../../../features/tab/sample/read-tournament';
import { HostStandings } from '../../../../../../../../ui/tab/standings/host-standings';

export const metadata: Metadata = { title: 'Standings' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.standings(slug));
  const rail = readTimelineRail(slug, scene);
  const table = readStandings(slug, null, scene);
  const setup = readSetup(slug, scene);
  if (rail === null || table === null || setup === null) notFound();
  return <HostStandings rail={rail} event={setup.event} table={table} />;
}
