import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readEventsSchedule } from '../../../../../../features/tab/events';
import { EventsSchedule } from '../../../../../../ui/tab/events-schedule/events-schedule';
import { sampleSubmit } from '../../../../../(tab)/sample-submit';
import { hostRoutes } from '../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../features/tab/tournament';
import { requireGrant } from '../../../require-grant';

export const metadata: Metadata = { title: 'Events and schedule' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug } = await params;
  const { event } = await searchParams;
  const scene = await requireGrant(hostRoutes.events(slug));
  const rail = readTimelineRail(slug, scene);
  const schedule = readEventsSchedule(
    slug,
    typeof event === 'string' ? event : null,
    scene,
  );
  if (rail === null || schedule === null) notFound();
  return (
    <EventsSchedule
      rail={rail}
      schedule={schedule}
      submit={sampleSubmit(hostRoutes.events(slug))}
    />
  );
}
