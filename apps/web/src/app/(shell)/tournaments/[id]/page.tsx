import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { SearchParams } from '../../../../features/access/decision';
import { parseDetailQuery } from '../../../../features/tournaments/detail-query';
import { getTournament } from '../../../../features/tournaments/get-tournament';
import { requestIdentity } from '../../../../lib/request-session';
import { TournamentDetail } from '../../../../ui/tournaments/detail/tournament-detail';

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
};

export const metadata: Metadata = { title: 'Tournament' };

/** Public: anyone can read a tournament; registering needs an account. */
export default async function TournamentPage({ params, searchParams }: Props) {
  const { id } = await params;
  const identity = await requestIdentity();
  const view = getTournament(id, identity.state === 'member');
  if (!view) notFound();
  return (
    <TournamentDetail
      view={view}
      query={parseDetailQuery(await searchParams)}
    />
  );
}
