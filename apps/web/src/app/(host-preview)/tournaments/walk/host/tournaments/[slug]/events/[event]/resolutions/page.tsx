import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireGrant } from '../../../../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../../../../features/tab/routes';
import { readResolutionPool } from '../../../../../../../../../../features/tab/sample/read-resolution-pool';
import { readTimelineRail } from '../../../../../../../../../../features/tab/sample/read-tournament';
import { Resolutions } from '../../../../../../../../../../ui/tab/resolutions/resolutions';

export const metadata: Metadata = { title: 'Resolutions' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string; event: string }>;
}) {
  const { slug, event } = await params;
  const scene = await requireGrant(hostRoutes.resolutions(slug, event));
  const rail = readTimelineRail(slug, scene);
  const pool = readResolutionPool(slug, event, scene);
  if (rail === null || pool === null) notFound();
  return <Resolutions rail={rail} pool={pool} />;
}
