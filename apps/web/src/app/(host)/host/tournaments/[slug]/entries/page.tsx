import { AUTUMN, WINTER } from '../../../../../../features/tab/sample/moment';
import { StoredRoster } from '../entries/stored-roster';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readHostEntries } from '../../../../../../features/tab/entries';
import { HostEntries } from '../../../../../../ui/tab/host-entries/host-entries';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Entries' };

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
        kind="entries"
        eventId={(await searchParams).event}
      />
    );
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
