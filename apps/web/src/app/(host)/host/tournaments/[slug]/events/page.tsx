import { requireTabRelease } from '../../../../../../features/tab/release';
import type { Metadata } from 'next';
import { StoredEvents } from './stored-events';

export const metadata: Metadata = { title: 'Events and schedule' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{
    event?: string | string[];
    new?: string | string[];
  }>;
}) {
  await requireTabRelease();
  const { slug } = await params;
  const { event, new: creating } = await searchParams;
  return (
    <StoredEvents
      handle={slug}
      eventId={typeof event === 'string' ? event : null}
      create={creating === 'event'}
    />
  );
}
