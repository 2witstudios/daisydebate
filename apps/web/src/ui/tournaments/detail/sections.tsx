import Link from 'next/link';
import { detailHref } from '../../../features/tournaments/detail-query';
import {
  formatDate,
  formatDay,
  formatTime,
} from '../../../features/tournaments/dates';
import { overviewFacts, ruleCards } from '../../../features/tournaments/facts';
import type {
  Entrant,
  TournamentView,
} from '../../../features/tournaments/get-tournament';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { statusOf } from '../../../features/tournaments/tournament';
import { Icon } from '../../components/icon/icon';
import { InertAction } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { FactList } from '../fact-list/fact-list';
import { Person } from '../person/person';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const h3 = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

export function Overview({ view }: { readonly view: TournamentView }) {
  const { tournament, schedule, recognition, description } = view;
  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <h2 className={h3}>About this tournament</h2>
        <p className="text-base text-ink-muted">{description}</p>
      </section>
      <section className={card}>
        <h2 className={h3}>Structure and rules</h2>
        <FactList facts={overviewFacts(tournament)} />
      </section>
      <section className={card}>
        <h2 className={h3}>Schedule</h2>
        <ol className="flex flex-col">
          {schedule.map((item) => (
            <li
              key={item.label}
              className="flex items-baseline justify-between gap-4 border-t border-border py-2 first:border-t-0"
            >
              <span className="flex flex-col">
                <span className="text-base text-ink">{item.label}</span>
                {item.note ? (
                  <span className="text-sm text-ink-muted">{item.note}</span>
                ) : null}
              </span>
              <span className="text-right text-base text-ink tabular-nums">
                {`${formatDay(item.at)}, ${formatTime(item.at)}`}
              </span>
            </li>
          ))}
        </ol>
        <p className="text-sm text-ink-faint">Times are UTC.</p>
      </section>
      <section className={card}>
        <h2 className={h3}>Recognition</h2>
        <ul className="flex flex-col gap-3">
          {recognition.map(({ title, text }) => (
            <li key={title} className="flex items-start gap-3 text-base">
              <span className="mt-1 text-gold">
                <Icon name="trophy" size={16} />
              </span>
              <span className="text-ink-muted">
                <b className="font-strong text-ink">{title}</b> {text}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

const PAGE_SIZE = 10;

function EntrantRow({
  entrant,
  you,
}: {
  readonly entrant: Entrant;
  readonly you: boolean;
}) {
  return (
    <li className="flex items-center justify-between gap-4 border-t border-border px-5 py-3 first:border-t-0">
      <Person handle={entrant.handle} you={you} />
      <span className="text-sm text-ink-muted tabular-nums">
        {entrant.rating ?? 'Provisional'}
      </span>
      <span className="text-sm text-ink-faint max-compact:hidden">
        {`Registered ${formatDate(entrant.registeredAt)}`}
      </span>
    </li>
  );
}

export function Entrants({
  view,
  all,
}: {
  readonly view: TournamentView;
  readonly all: boolean;
}) {
  const { tournament, entrants, viewer } = view;
  const shown = all ? entrants : entrants.slice(0, PAGE_SIZE);
  const left = tournament.places - tournament.entered;
  const title = `${tournament.entered} entered, ${
    left > 0 ? `${left} places left` : `${tournament.waitlisted} waiting`
  }`;
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-md font-strong text-ink">{title}</h2>
      {entrants.length === 0 ? (
        <p className="rounded-lg border border-border bg-surface p-5 text-base text-ink-muted">
          No one has entered yet.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
          {shown.map((entrant) => (
            <EntrantRow
              key={entrant.handle}
              entrant={entrant}
              you={entrant.handle === viewer?.handle}
            />
          ))}
        </ul>
      )}
      {entrants.length > shown.length ? (
        <Link
          href={detailHref(tournament.id, { tab: 'entrants', all: true })}
          className="font-strong"
        >
          {`Show all ${entrants.length}`}
        </Link>
      ) : null}
    </section>
  );
}

export function BracketTab({ view }: { readonly view: TournamentView }) {
  const { tournament, schedule } = view;
  const status = statusOf(tournament);
  const posted = status === 'live' || status === 'done' || status === 'closed';
  const post = schedule.find((item) => item.label !== 'Registration closes');
  return (
    <section className={card}>
      <h2 className="text-md font-strong text-ink">
        {posted ? 'Bracket' : 'Bracket not posted yet'}
      </h2>
      {!posted && post ? (
        <p className="text-base text-ink-muted">
          {`Posts ${formatDay(post.at)}, ${formatTime(post.at)} UTC`}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {posted ? (
          <LinkButton
            href={tournamentRoutes.bracket(tournament.id)}
            variant="primary"
          >
            Open the bracket
          </LinkButton>
        ) : (
          <InertAction id="notifyBracket" />
        )}
      </div>
    </section>
  );
}

export function RulesTab({ view }: { readonly view: TournamentView }) {
  return (
    <section className={card}>
      <ul className="flex flex-col gap-5">
        {ruleCards(view.tournament).map(({ icon, title, text }) => (
          <li key={title} className="flex items-start gap-3">
            <span className="mt-1 text-accent">
              <Icon name={icon} size={18} />
            </span>
            <div className="flex flex-col gap-1">
              <h2 className="text-md font-strong text-ink">{title}</h2>
              <p className="text-base text-ink-muted">{text}</p>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
