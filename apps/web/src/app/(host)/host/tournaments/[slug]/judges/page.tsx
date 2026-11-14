import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readHostJudges } from '../../../../../../features/tab/entries';
import { HostJudges } from '../../../../../../ui/tab/host-entries/host-judges';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Judges' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
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
