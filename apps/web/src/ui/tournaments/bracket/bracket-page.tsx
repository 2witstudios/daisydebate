import {
  bracketHref,
  viewsFor,
  type BracketData,
  type BracketView,
} from '../../../features/tournaments/bracket';
import { formatTime } from '../../../features/tournaments/dates';
import {
  rulesLabel,
  structureLabel,
} from '../../../features/tournaments/labels';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import type { Tournament } from '../../../features/tournaments/tournament';
import { SampleButton } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { PageFrame, PageTitle } from '../page-frame/page-frame';
import { StatusBadge } from '../status-badge/status-badge';
import { TabLinks } from '../../components/tab-links/tab-links';
import { BracketTree, RoundList } from './elimination';
import { ResultsGrid, RobinRounds, StandingsTable } from './robin';

const viewLabels: Readonly<Record<BracketView, string>> = {
  bracket: 'Bracket',
  rounds: 'By round',
  standings: 'Standings',
  grid: 'Results grid',
};

export type BracketPageProps = {
  readonly data: BracketData;
  readonly view: BracketView;
  readonly viewerHandle: string | null;
  /** The viewer competes here: link to their event. */
  readonly myEvent: boolean;
};

function Body({ data, view, viewerHandle }: Omit<BracketPageProps, 'myEvent'>) {
  if (data.kind === 'elimination')
    return view === 'rounds' ? (
      <RoundList data={data} viewerHandle={viewerHandle} />
    ) : (
      <>
        <BracketTree data={data} viewerHandle={viewerHandle} />
        <div className="hidden max-compact:block">
          <RoundList data={data} viewerHandle={viewerHandle} />
        </div>
      </>
    );
  if (view === 'grid') return <ResultsGrid data={data} />;
  if (view === 'rounds') return <RobinRounds data={data} />;
  return <StandingsTable data={data} viewerHandle={viewerHandle} />;
}

/** Follow a live tournament: bracket or standings, updating as ballots land. */
export function BracketPage({
  data,
  view,
  viewerHandle,
  myEvent,
}: BracketPageProps) {
  const { tournament } = data;
  const places = `${structureLabel(tournament.structure)}, ${tournament.entered} entrants, ${rulesLabel(tournament.rules).toLowerCase()}. Unrated.`;
  return (
    <PageFrame>
      <PageTitle
        trail={[
          { label: 'Tournaments', href: tournamentRoutes.index },
          {
            label: tournament.name,
            href: tournamentRoutes.detail(tournament.id),
          },
          { label: 'Bracket' },
        ]}
        title={tournament.name}
        badges={<StatusBadge status="live" />}
      >
        <p className="text-base text-ink-muted">{places}</p>
      </PageTitle>
      <div
        role="status"
        aria-live="polite"
        className="flex flex-wrap items-center gap-x-2 rounded-lg border border-border bg-surface px-4 py-3 text-base text-ink-muted"
      >
        <span className="font-strong text-live">Live.</span>
        <span>{data.liveLine}</span>
        <span className="ml-auto text-sm text-ink-faint">{`Updated ${formatTime(data.updatedAt)}`}</span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <TabLinks
          label="View"
          tabs={viewsFor(tournament.structure).map((item) => ({
            id: item,
            label: viewLabels[item],
            href: bracketHref(tournament.id, item, tournament.structure),
            selected: item === view,
          }))}
        />
        <div className="flex gap-3">
          <SampleButton label="Share" variant="ghost" />
          {myEvent ? (
            <LinkButton href={tournamentRoutes.myEvent(tournament.id)}>
              Open my event
            </LinkButton>
          ) : null}
        </div>
      </div>
      <Body data={data} view={view} viewerHandle={viewerHandle} />
    </PageFrame>
  );
}

/** A tournament with no live bracket: not out yet, or already over. */
export function NotPosted({ tournament }: { readonly tournament: Tournament }) {
  const over = tournament.lifecycle === 'completed';
  return (
    <PageFrame>
      <header className="flex max-w-prose flex-col gap-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight">
          {over
            ? `${tournament.name} is over`
            : `The ${tournament.name} bracket is not out yet`}
        </h1>

        <div className="flex flex-wrap gap-3">
          <LinkButton
            href={
              over
                ? tournamentRoutes.results(tournament.id)
                : tournamentRoutes.detail(tournament.id)
            }
            variant="primary"
          >
            {over ? 'See the results' : 'Back to the tournament'}
          </LinkButton>
        </div>
      </header>
    </PageFrame>
  );
}
