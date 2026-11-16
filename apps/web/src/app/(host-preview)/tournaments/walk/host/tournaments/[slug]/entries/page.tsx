import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireGrant } from '../../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../../features/tab/routes';
import { readHostEntries } from '../../../../../../../../features/tab/sample/read-entries';
import { readTimelineRail } from '../../../../../../../../features/tab/sample/read-tournament';
import { HostEntries } from '../../../../../../../../ui/tab/host-entries/host-entries';

export const metadata: Metadata = { title: 'Entries' };

export default async function Page({
  params,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string }>;
}) {
  const { slug } = await params;
  const scene = await requireGrant(hostRoutes.entries(slug));
  const rail = readTimelineRail(slug, scene);
  const entries = readHostEntries(slug, scene);
  if (rail === null || entries === null) notFound();
  return (
    <HostEntries
      rail={rail}
      entries={entries}
      entriesHref={hostRoutes.entries(slug)}
      judgesHref={hostRoutes.judges(slug)}
    />
  );
}
