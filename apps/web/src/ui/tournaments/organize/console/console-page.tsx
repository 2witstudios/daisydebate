import type { ConsoleView } from '../../../../features/tournaments/console-view';
import { tournamentRoutes } from '../../../../features/tournaments/routes';
import { Badge } from '../../../components/badge/badge';
import { Breadcrumb } from '../../breadcrumb/breadcrumb';
import { LinkButton } from '../../link-button/link-button';
import { PageFrame } from '../../page-frame/page-frame';
import { TabLinks } from '../../tab-links/tab-links';
import { EntrantsTab, RoundsTab } from './rounds';
import { ModerationTab, PublishTab, ResultsTab } from './results';

function Body({ view }: { readonly view: ConsoleView }) {
  switch (view.tab) {
    case 'entrants':
      return <EntrantsTab view={view} />;
    case 'rounds':
      return <RoundsTab view={view} />;
    case 'results':
      return <ResultsTab view={view} />;
    case 'moderation':
      return <ModerationTab view={view} />;
    case 'publish':
      return <PublishTab view={view} />;
  }
}

/** The organizer console: prepare rounds, enter results, moderate, publish. */
export function ConsolePage({ view }: { readonly view: ConsoleView }) {
  const { tournament } = view.data;
  return (
    <PageFrame>
      <div className="flex flex-col gap-3">
        <Breadcrumb
          trail={[
            { label: 'Organize', href: tournamentRoutes.organize },
            { label: tournament.name },
          ]}
        />
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            {`${tournament.name} console`}
          </h1>
          <Badge
            tone={tournament.lifecycle === 'in-progress' ? 'live' : 'accent'}
          >
            {tournament.lifecycle === 'in-progress'
              ? 'In progress'
              : 'Registration closed'}
          </Badge>
          <LinkButton
            href={tournamentRoutes.detail(tournament.id)}
            variant="ghost"
          >
            View public page
          </LinkButton>
        </div>
        <p className="text-base text-ink-muted">{view.phaseLabel}</p>
      </div>
      <TabLinks label="Console sections" tabs={view.tabs} />
      <Body view={view} />
    </PageFrame>
  );
}

/** The tournament is unknown or not the viewer's to run. */
export function ConsoleUnavailable() {
  return (
    <PageFrame>
      <header className="flex max-w-prose flex-col gap-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight">
          We could not find that tournament
        </h1>
        <p className="text-base text-ink-muted">
          You can only manage tournaments you organize.
        </p>
        <div>
          <LinkButton href={tournamentRoutes.organize} variant="primary">
            Back to Organize
          </LinkButton>
        </div>
      </header>
    </PageFrame>
  );
}
