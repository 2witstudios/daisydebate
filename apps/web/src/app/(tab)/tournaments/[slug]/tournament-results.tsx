import { notFound } from 'next/navigation';
import { tabRoutes } from '../../../../features/tab/routes';
import { bracketOf } from '../../../../features/tab/results';
import { lockedSetting } from '../../../../features/tab/settings';
import { standingsTableOf } from '../../../../features/tab/standings';
import { PageHeader } from '../../../../ui/components/page-header/page-header';
import { TabLinks } from '../../../../ui/components/tab-links/tab-links';
import { BackButton } from '../../../../ui/tab/action-control/action-control';
import { Bracket } from '../../../../ui/tab/bracket/bracket';
import { StandingsTable } from '../../../../ui/tab/standings/standings-table';
import { storedTournament, storedTournamentResults } from '../read-tournament';

export async function TournamentResults({
  slug,
  eventId,
  section,
}: {
  readonly slug: string;
  readonly eventId: string | null;
  readonly section: 'standings' | 'bracket';
}) {
  const tournament = eventId ? null : await storedTournament(slug);
  const selected = eventId ?? tournament?.schedule[0]?.eventId;
  const result = selected
    ? await storedTournamentResults(slug, selected, section)
    : null;
  if (selected && !result) notFound();
  const name = result?.name ?? tournament?.name;
  if (!name) notFound();
  const events = new Map(result?.events.map(({ id, label }) => [id, label]));
  const tabs = [...events].map(([id, label]) => ({
    id,
    label,
    href: tabRoutes[section](slug, id),
    selected: id === selected,
  }));
  const standings = result?.kind === 'standings' ? result.standings : null;
  const table = standings
    ? standingsTableOf(standings, {
        keys: ['standings.tiebreaks'],
        label: 'Tiebreaks',
        value: '',
        source: {
          scope: 'event',
          name: events.get(standings.eventId) ?? name,
        },
        control: lockedSetting,
        attention: null,
      })
    : null;
  return (
    <div className="mx-auto flex max-w-dash-column flex-col gap-5 px-4 py-6">
      {tournament || result?.tournamentReadable ? (
        <BackButton label={name} href={tabRoutes.tournament(slug)} />
      ) : null}
      <PageHeader
        title={
          section === 'bracket' ? 'Bracket' : (table?.title ?? 'Standings')
        }
      />
      {tabs.length > 1 ? <TabLinks label="Events" tabs={tabs} /> : null}
      {section === 'standings' ? (
        table && table.rows.length ? (
          <StandingsTable table={table} />
        ) : (
          <p>Standings will appear when results are released.</p>
        )
      ) : result?.kind === 'bracket' && result.brackets.length ? (
        result.brackets.map((bracket) => (
          <section key={bracket.stageId} className="flex flex-col gap-3">
            {bracket.division ? (
              <h2 className="font-strong">{bracket.division}</h2>
            ) : null}
            <Bracket bracket={bracketOf(bracket, (at) => at.slice(11, 16))} />
          </section>
        ))
      ) : (
        <p>No elimination bracket has been scheduled.</p>
      )}
    </div>
  );
}
