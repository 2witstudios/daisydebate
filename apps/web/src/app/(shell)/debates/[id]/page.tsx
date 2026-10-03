import { systemClock } from '@daisy/clock';
import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { getDebateInfo } from '../../../../features/debates/get-debate';
import { parseDebateQuery } from '../../../../features/debates/state';
import { debateView } from '../../../../features/debates/view';
import { requireAccess } from '../../../../lib/access';
import { DebatePage } from '../../../../ui/debates/debate-page/debate-page';

export const metadata: Metadata = { title: 'Debate' };

export default async function DebateRoute({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  await requireAccess(`/debates/${id}`, searchParams);
  const info = getDebateInfo(id, systemClock.now());
  if (info === null) notFound();
  return (
    <DebatePage view={debateView(info, parseDebateQuery(await searchParams))} />
  );
}
