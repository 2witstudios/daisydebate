import { requireTabRelease } from '../../../../../../features/tab/release';
import type { Metadata } from 'next';
import { StoredRoster } from '../entries/stored-roster';

export const metadata: Metadata = { title: 'Entries' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string }>;
  readonly searchParams: Promise<{ event?: string }>;
}) {
  await requireTabRelease();
  const { slug } = await params;
  return (
    <StoredRoster
      handle={slug}
      kind="entries"
      eventId={(await searchParams).event}
    />
  );
}
