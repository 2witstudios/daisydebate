import Link from 'next/link';
import { tabRoutes } from '../../../features/tab/routes';
import type { TournamentSummary } from '../../../features/tab/tournament';
import { PageHeader } from '../../components/page-header/page-header';
import { ReadingPage } from '../../components/reading-page/reading-page';
import { ListCard, ListRow } from '../list-card/list-card';

/** The tournaments a viewer may see, soonest first. */
export function TournamentsDirectory({
  tournaments,
  league,
}: {
  readonly tournaments: readonly TournamentSummary[];
  readonly league: { readonly name: string; readonly href: string };
}) {
  return (
    <ReadingPage>
      <PageHeader title="Tournaments" />
      <ListCard label="Tournaments">
        <ul>
          {tournaments.map((tournament) => (
            <ListRow
              key={tournament.slug}
              title={
                <Link
                  href={tabRoutes.tournament(tournament.slug)}
                  className="text-ink"
                >
                  {tournament.name}
                </Link>
              }
              detail={tournament.detail}
            />
          ))}
        </ul>
      </ListCard>
      <p className="flex flex-wrap gap-x-6 gap-y-2">
        <Link href={league.href} className="font-strong text-ink underline">
          {league.name}
        </Link>
        <Link href={tabRoutes.walk} className="font-strong text-ink underline">
          Walk the sample tournament
        </Link>
      </p>
    </ReadingPage>
  );
}
