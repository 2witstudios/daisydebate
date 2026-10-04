import type { EventScreen } from '../../../features/tournaments/event';
import type { Tournament } from '../../../features/tournaments/tournament';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import {
  rulesLabel,
  structureLabel,
} from '../../../features/tournaments/labels';
import { formatTime } from '../../../features/tournaments/dates';
import { DisabledAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { PageFrame, PageTitle } from '../page-frame/page-frame';
import { StatusBadge } from '../status-badge/status-badge';
import { Hero } from './hero';
import { cn } from '../../cn';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const h3 = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

const markClass = (mark: string): string =>
  cn(
    'inline-flex size-8 shrink-0 items-center justify-center rounded-round border text-xs font-bold',
    mark === 'W' && 'border-accent bg-accent text-accent-ink',
    mark === 'L' && 'border-border-strong text-ink-muted',
    mark === 'Now' && 'border-accent bg-accent-soft text-accent',
    mark === '' && 'border-border text-ink-faint',
  );

export type EventPageProps = {
  readonly screen: EventScreen;
  readonly tournament: Tournament;
  readonly finalAt: string;
};

/** The viewer's own event: what is next, their path and their rounds. */
export function EventPage({ screen, tournament, finalAt }: EventPageProps) {
  const { pairing } = screen;
  return (
    <PageFrame>
      <PageTitle
        trail={[
          { label: 'My events' },
          {
            label: tournament.name,
            href: tournamentRoutes.detail(tournament.id),
          },
        ]}
        title={tournament.name}
        badges={
          <>
            <StatusBadge status="live" />
            <span className="text-base text-ink-muted">
              {screen.roundLabel}
            </span>
          </>
        }
      />
      <div className="flex items-start gap-6 max-rail:flex-col">
        <div className="flex min-w-0 flex-1 flex-col gap-4 max-rail:w-full">
          <div aria-live="polite" className="flex flex-col gap-4">
            <Hero hero={screen.hero} pairing={pairing} />
          </div>
          <section className={card}>
            <h2 className={h3}>Your path</h2>
            <ol aria-label="Your path" className="flex flex-col gap-3">
              {screen.path.map((step) => (
                <li key={step.stage} className="flex items-center gap-3">
                  <span className={markClass(step.mark)} aria-hidden="true">
                    {step.mark}
                  </span>
                  <span className="flex flex-col">
                    <span className="text-base font-strong text-ink">
                      {step.stage}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {step.detail}
                    </span>
                  </span>
                </li>
              ))}
            </ol>
          </section>
          <section className={card}>
            <h2 className={h3}>Your rounds</h2>
            <ul className="flex flex-col">
              {screen.rounds.map((round) => (
                <li
                  key={round.stage}
                  className="flex items-center justify-between gap-4 border-t border-border py-3 first:border-t-0"
                >
                  <span className="flex flex-col">
                    <span className="text-base font-strong text-ink">
                      {round.stage}
                    </span>
                    <span className="text-sm text-ink-muted">
                      {`vs @${round.opponent}, ${round.side}, judge @${round.judge}`}
                    </span>
                  </span>
                  <span className="text-sm font-strong text-ink">
                    {round.result}
                  </span>
                  <LinkButton href="/recordings" variant="ghost">
                    Recording
                  </LinkButton>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside
          aria-label="Your tournaments"
          className="flex w-rail shrink-0 flex-col gap-4 max-rail:w-full"
        >
          <section className={card}>
            <h2 className={h3}>{tournament.name}</h2>
            <ul className="flex flex-col gap-2 text-base text-ink-muted">
              <li className="flex justify-between">
                <span>Quarterfinals</span>
                <span>Done</span>
              </li>
              <li className="flex justify-between">
                <span>Semifinals</span>
                <span>{`Today ${formatTime(pairing.startsAt)}`}</span>
              </li>
              <li className="flex justify-between">
                <span>Final</span>
                <span>{`Today ${formatTime(finalAt)}`}</span>
              </li>
            </ul>
            <p className="text-sm text-ink-faint">
              {`${structureLabel(tournament.structure)}, ${tournament.entered} entrants, ${rulesLabel(tournament.rules).toLowerCase()}. Unrated.`}
            </p>
            <LinkButton href={tournamentRoutes.bracket(tournament.id)}>
              Open the bracket
            </LinkButton>
          </section>
          <section className={card}>
            <h2 className={h3}>Need help?</h2>
            <DisabledAction label="Contact the organizer" />
            <DisabledAction label="Report a problem" variant="ghost" />
          </section>
        </aside>
      </div>
    </PageFrame>
  );
}

/** The viewer is not competing here: nothing to show, a way out. */
export function NotInEvent({
  tournament,
}: {
  readonly tournament: Tournament | null;
}) {
  return (
    <PageFrame>
      <header className="flex flex-col gap-3">
        <h1 className="font-display text-3xl leading-tight font-bold tracking-tight">
          {tournament
            ? `You are not competing in ${tournament.name}`
            : 'We could not find that event'}
        </h1>
        <div>
          <LinkButton
            href={
              tournament
                ? tournamentRoutes.detail(tournament.id)
                : tournamentRoutes.index
            }
            variant="primary"
          >
            {tournament ? 'View the tournament' : 'Browse tournaments'}
          </LinkButton>
        </div>
      </header>
    </PageFrame>
  );
}
