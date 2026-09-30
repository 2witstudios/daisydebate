import { tournamentRoutes } from '../../../features/tournaments/routes';
import type { MyResult } from '../../../features/tournaments/results';
import type { Tournament } from '../../../features/tournaments/tournament';
import { LinkButton } from '../link-button/link-button';
import { Certificate } from './certificate';

/** The printable certificate page: one certificate, a way back, a print note. */
export function CertificatePage({
  tournament,
  mine,
}: {
  readonly tournament: Tournament;
  readonly mine: MyResult;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 py-8 max-compact:px-4">
      <header className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-2xl leading-tight font-bold tracking-tight">
            {`${tournament.name} certificate`}
          </h1>
          <p className="text-base text-ink-muted">
            Use your browser’s print command to print this page or save it as a
            PDF.
          </p>
        </div>
        <LinkButton href={tournamentRoutes.results(tournament.id)}>
          Back to results
        </LinkButton>
      </header>
      <Certificate tournament={tournament} certificate={mine.certificate} />
    </div>
  );
}
