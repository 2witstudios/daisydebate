import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireGrant } from '../../../../../../../../(tab)/tournaments/walk/require-grant';
import { hostRoutes } from '../../../../../../../../../features/tab/routes';
import { readTimeSlot } from '../../../../../../../../../features/tab/sample/read-tab-round';
import { readTimelineRail } from '../../../../../../../../../features/tab/sample/read-tournament';
import { TimeSlot } from '../../../../../../../../../ui/tab/time-slot/time-slot';

export const metadata: Metadata = { title: 'Time slot' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string; slot: string }>;
  readonly searchParams: Promise<{ event?: string | string[] }>;
}) {
  const { slug, slot } = await params;
  const { event } = await searchParams;
  const scene = await requireGrant(hostRoutes.slot(slug, slot));
  const rail = readTimelineRail(slug, scene);
  const read = readTimeSlot(
    slug,
    slot,
    typeof event === 'string' ? event : null,
    scene,
  );
  if (rail === null || read === null) notFound();
  return <TimeSlot rail={rail} current={`slot-${slot}`} slot={read} />;
}
