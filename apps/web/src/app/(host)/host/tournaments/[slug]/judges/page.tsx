import { AUTUMN, WINTER } from '../../../../../../features/tab/sample/moment';
import { StoredRoster } from '../entries/stored-roster';
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
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string }>;
}) {
  const { slug } = await params;
  if (slug !== AUTUMN && slug !== WINTER)
    return (
      <StoredRoster
        handle={slug}
        kind="judges"
        eventId={(await searchParams).event}
      />
    );
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
