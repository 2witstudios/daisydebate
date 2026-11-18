import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireGrant } from '../../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readHostJudges } from '../../../../../../../../features/tab/sample/read-entries';
import { readTimelineRail } from '../../../../../../../../features/tab/sample/read-tournament';
import { HostJudges } from '../../../../../../../../ui/tab/host-entries/host-judges';

export const metadata: Metadata = { title: 'Judges' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.judges(slug));
  const rail = readTimelineRail(slug, scene);
  const judges = readHostJudges(slug, scene);
  if (rail === null || judges === null) notFound();
  return (
    <HostJudges
      rail={rail}
      judges={judges}
      entriesHref={hostRoutes.entries(slug)}
      judgesHref={hostRoutes.judges(slug)}
    />
  );
}
