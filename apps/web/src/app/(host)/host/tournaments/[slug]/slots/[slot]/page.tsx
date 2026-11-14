import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { readTimeSlot } from '../../../../../../../features/tab/tab-round';
import { TimeSlot } from '../../../../../../../ui/tab/time-slot/time-slot';
import { hostRoutes } from '../../../../../../../features/tab/routes';
import { readTimelineRail } from '../../../../../../../features/tab/tournament';
import { requireGrant } from '../../../../require-grant';

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
