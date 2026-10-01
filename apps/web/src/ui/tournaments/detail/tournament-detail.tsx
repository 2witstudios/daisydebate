import {
  detailHref,
  detailTabs,
  type DetailQuery,
  type DetailTab,
} from '../../../features/tournaments/detail-query';
import type { TournamentView } from '../../../features/tournaments/get-tournament';
import {
  rulesLabel,
  structureLabel,
} from '../../../features/tournaments/labels';
import { registrationPanel } from '../../../features/tournaments/panel';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { statusOf } from '../../../features/tournaments/tournament';
import { Badge } from '../../components/badge/badge';
import { PageFrame, PageTitle } from '../page-frame/page-frame';
import { StatusBadge } from '../status-badge/status-badge';
import { TabLinks } from '../tab-links/tab-links';
import { RegistrationPanel } from './registration-panel';
import { BracketTab, Entrants, Overview, RulesTab } from './sections';

const tabLabels: Readonly<Record<DetailTab, string>> = {
  overview: 'Overview',
  entrants: 'Entrants',
  bracket: 'Bracket',
  rules: 'Rules and judging',
};

function Tab({
  view,
  query,
}: {
  readonly view: TournamentView;
  readonly query: DetailQuery;
}) {
  switch (query.tab) {
    case 'overview':
      return <Overview view={view} />;
    case 'entrants':
      return <Entrants view={view} all={query.all} />;
    case 'bracket':
      return <BracketTab view={view} />;
    case 'rules':
      return <RulesTab view={view} />;
  }
}

export type TournamentDetailProps = {
  readonly view: TournamentView;
  readonly query: DetailQuery;
};

/** One tournament: what it is, who is in, and the viewer's next step. */
export function TournamentDetail({ view, query }: TournamentDetailProps) {
  const { tournament } = view;
  return (
    <PageFrame>
      <PageTitle
        trail={[
          { label: 'Tournaments', href: tournamentRoutes.index },
          { label: tournament.name },
        ]}
        title={tournament.name}
        badges={<StatusBadge status={statusOf(tournament)} />}
      >
        <div className="flex flex-wrap gap-2">
          <Badge>{structureLabel(tournament.structure)}</Badge>
          <Badge>{rulesLabel(tournament.rules)}</Badge>
          <Badge tone="accent">Unrated</Badge>
        </div>
        <p className="text-base text-ink-muted">
          {`Organized by ${tournament.organizer}.`}
        </p>
      </PageTitle>
      <div className="flex items-start gap-6 max-rail:flex-col-reverse">
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-rail:w-full">
          <TabLinks
            label="Tournament sections"
            tabs={detailTabs.map((tab) => ({
              id: tab,
              label: tabLabels[tab],
              href: detailHref(tournament.id, { tab, all: false }),
              selected: query.tab === tab,
              ...(tab === 'entrants' ? { count: tournament.entered } : {}),
            }))}
          />
          <Tab view={view} query={query} />
        </div>
        <div className="w-rail shrink-0 max-rail:w-full">
          <RegistrationPanel
            panel={registrationPanel(view)}
            tournament={tournament}
          />
        </div>
      </div>
    </PageFrame>
  );
}
