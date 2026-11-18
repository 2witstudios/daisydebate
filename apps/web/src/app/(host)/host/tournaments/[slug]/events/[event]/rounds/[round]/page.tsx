import { requireTabRelease } from '../../../../../../../../../features/tab/release';
import type { Metadata } from 'next';
import { StoredRound } from './stored-round';

export const metadata: Metadata = { title: 'Round' };

export default async function Page({
  params,
  searchParams,
}: {
  readonly params: Promise<{ slug: string; event: string; round: string }>;
  readonly searchParams: Promise<{ fixture?: string | string[] }>;
}) {
  await requireTabRelease();
  const { slug, event, round } = await params;
  const { fixture } = await searchParams;
  return (
    <StoredRound
      handle={slug}
      eventId={event}
      tabRoundId={round}
      selectedFixtureId={typeof fixture === 'string' ? fixture : null}
    />
  );
}
