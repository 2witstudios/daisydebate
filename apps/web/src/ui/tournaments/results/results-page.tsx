import {
  resultsHref,
  resultsTabs,
  type ResultsData,
  type ResultsQuery,
  type ResultsTab,
} from '../../../features/tournaments/results';
import { formatDay } from '../../../features/tournaments/dates';
import {
  rulesLabel,
  structureLabel,
} from '../../../features/tournaments/labels';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { Badge } from '../../components/badge/badge';
import { Icon } from '../../components/icon/icon';
import { LinkButton } from '../link-button/link-button';
import { PageFrame, PageTitle } from '../page-frame/page-frame';
import { TabLinks } from '../../components/tab-links/tab-links';
import { Honours, Mine, Rounds, Standings } from './results-tabs';

const tabLabels: Readonly<Record<ResultsTab, string>> = {
  standings: 'Final standings',
  rounds: 'Last rounds',
  honours: 'Honours',
  mine: 'Your result',
};

export type ResultsPageProps = {
  readonly data: ResultsData;
  readonly query: ResultsQuery;
  readonly viewerHandle: string | null;
};

/** Published results: the champion, standings, last rounds, honours, yours. */
export function ResultsPage({ data, query, viewerHandle }: ResultsPageProps) {
  const { tournament } = data;
  const champion = data.standings[0];
  const tabs = resultsTabs.filter(
    (tab) => tab !== 'mine' || data.mine !== null,
  );
  return (
    <PageFrame>
      <PageTitle
        trail={[
          { label: 'Tournaments', href: tournamentRoutes.index },
          {
            label: tournament.name,
            href: tournamentRoutes.detail(tournament.id),
          },
          { label: 'Results' },
        ]}
        title={tournament.name}
        badges={<Badge tone="accent">Results published</Badge>}
      >
        <p className="text-base text-ink-muted">
          {`${structureLabel(tournament.structure)}, ${tournament.entered} entrants, ${rulesLabel(tournament.rules).toLowerCase()}. Organized by ${tournament.organizer}. Results published ${formatDay(data.publishedAt)}.`}
        </p>
      </PageTitle>
      {champion ? (
        <section className="flex items-center gap-4 rounded-xl bg-surface-stage p-8 text-stage-ink shadow-1 max-compact:p-5">
          <span className="text-stage-accent">
            <Icon name="trophy" size={40} />
          </span>
          <div className="flex flex-col gap-1">
            <p className="text-xs font-bold tracking-widest text-stage-accent uppercase">
              {`${tournament.outcome?.label ?? 'Champion'}, ${tournament.name}`}
            </p>
            <h2 className="font-display text-2xl leading-tight font-bold tracking-tight">{`@${champion.handle}`}</h2>
            <p className="text-sm text-stage-ink-muted">
              {`Seed ${champion.seed} · ${champion.rating} · ${structureLabel(tournament.structure)} · ${tournament.entered} entrants · ${formatDay(tournament.startsAt)}`}
            </p>
          </div>
        </section>
      ) : null}
      <TabLinks
        label="Results sections"
        tabs={tabs.map((tab) => ({
          id: tab,
          label: tabLabels[tab],
          href: resultsHref(tournament.id, { tab, all: false }),
          selected: query.tab === tab,
        }))}
      />
      {query.tab === 'standings' ? (
        <Standings data={data} all={query.all} viewer={viewerHandle} />
      ) : null}
      {query.tab === 'rounds' ? <Rounds data={data} /> : null}
      {query.tab === 'honours' ? <Honours data={data} /> : null}
      {query.tab === 'mine' ? <Mine data={data} /> : null}
    </PageFrame>
  );
}

/** A tournament whose results are not published. */
export function ResultsUnpublished({
  name,
  id,
}: {
  readonly name: string;
  readonly id: string;
}) {
  return (
    <PageFrame>
      <header className="flex max-w-prose flex-col gap-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight">
          {`${name} has no published results`}
        </h1>
        <div>
          <LinkButton href={tournamentRoutes.detail(id)} variant="primary">
            Back to the tournament
          </LinkButton>
        </div>
      </header>
    </PageFrame>
  );
}
