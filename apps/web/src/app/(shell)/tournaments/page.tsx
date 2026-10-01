import type { Metadata } from 'next';
import type { SearchParams } from '../../../features/access/decision';
import { listTournaments } from '../../../features/tournaments/list-tournaments';
import { parseTournamentsQuery } from '../../../features/tournaments/query';
import { requestIdentity } from '../../../lib/request-session';
import { TournamentsIndex } from '../../../ui/tournaments/index/tournaments-index';

export const metadata: Metadata = { title: 'Tournaments' };

/** Public: anyone can browse and follow events. */
export default async function TournamentsPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const query = parseTournamentsQuery(await searchParams);
  const identity = await requestIdentity();
  return (
    <TournamentsIndex
      listing={listTournaments(query, identity.state === 'member')}
      query={query}
    />
  );
}
