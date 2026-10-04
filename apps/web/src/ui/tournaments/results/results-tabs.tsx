import {
  resultsHref,
  type ResultsData,
} from '../../../features/tournaments/results';
import { tournamentRoutes } from '../../../features/tournaments/routes';
import { Badge } from '../../components/badge/badge';
import { Icon } from '../../components/icon/icon';
import { Certificate } from '../certificate/certificate';
import { SampleButton } from '../inert-action/inert-action';
import { LinkButton } from '../link-button/link-button';
import { cn } from '../../cn';

const card = 'flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1';
const PAGE = 8;

export function Standings({
  data,
  all,
  viewer,
}: {
  readonly data: ResultsData;
  readonly all: boolean;
  readonly viewer: string | null;
}) {
  const shown = all ? data.standings : data.standings.slice(0, PAGE);
  const hidden = data.standings.length - shown.length;
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
        <table className="w-full text-left">
          <caption className="sr-only">Final standings</caption>
          <thead>
            <tr className="text-2xs font-bold tracking-wider text-ink-faint uppercase">
              <th scope="col" className="px-4 py-3">
                Place
              </th>
              <th scope="col" className="px-4 py-3">
                Debater
              </th>
              <th scope="col" className="px-4 py-3">
                Record
              </th>
              <th scope="col" className="px-4 py-3">
                Honour
              </th>
            </tr>
          </thead>
          <tbody>
            {shown.map((row) => (
              <tr key={row.handle} className="border-t border-border">
                <td className="px-4 py-3 text-base tabular-nums">
                  {row.place}
                </td>
                <td className="px-4 py-3">
                  <span className="flex flex-col">
                    <span className="flex items-center gap-2 text-base font-strong text-ink">
                      {`@${row.handle}`}
                      {row.handle === viewer ? (
                        <span className="text-xs font-bold text-accent uppercase">
                          You
                        </span>
                      ) : null}
                    </span>
                    <span className="text-sm text-ink-muted">{`Seed ${row.seed}, rating ${row.rating}`}</span>
                  </span>
                </td>
                <td className="px-4 py-3 text-base tabular-nums">
                  {row.record}
                </td>
                <td className="px-4 py-3 text-sm text-ink-muted">
                  {row.honour ? (
                    <span className="inline-flex items-center gap-1 text-gold">
                      <Icon name="trophy" size={14} />
                      {row.honour}
                    </span>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hidden > 0 ? (
          <p className="border-t border-border px-4 py-3 text-base text-ink-muted">
            {`${hidden} more, equal ${PAGE + 1}th. `}
            <a
              href={resultsHref(data.tournament.id, {
                tab: 'standings',
                all: true,
              })}
              className="font-strong"
            >
              {`Show all ${data.standings.length} entrants`}
            </a>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export function Rounds({ data }: { readonly data: ResultsData }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="overflow-hidden rounded-lg border border-border bg-surface shadow-1">
        {data.lastRounds.map((round) => (
          <li
            key={`${round.label}-${round.winner}`}
            className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 first:border-t-0"
          >
            <span className="text-base font-strong text-ink">
              {round.label}
            </span>
            <span className="text-base text-ink-muted">
              <b className="font-strong text-ink">{`@${round.winner}`}</b>
              {` beat @${round.loser}`}
            </span>
            <span className="text-sm text-ink-faint">{`Judge @${round.judge}`}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Honours({ data }: { readonly data: ResultsData }) {
  return (
    <div className="flex flex-col gap-3">
      <ul className="grid grid-cols-2 gap-3 max-compact:grid-cols-1">
        {data.honours.map((honour) => (
          <li
            key={honour.title}
            className="flex items-start gap-3 rounded-lg border border-gold-border bg-gold-soft p-4"
          >
            <span className="mt-1 text-gold">
              <Icon name="trophy" size={20} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="text-xs font-bold tracking-wider text-gold uppercase">
                {honour.title}
              </span>
              <span className="text-md font-strong text-ink">{honour.who}</span>
              <span className="text-sm text-ink-muted">{honour.text}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Mine({ data }: { readonly data: ResultsData }) {
  const { mine, tournament } = data;
  if (!mine) return null;
  return (
    <div className="flex flex-col gap-4">
      <section className={card}>
        <Badge tone="gold">{`${mine.honour}, honour earned`}</Badge>
        <h2 className="font-display text-2xl leading-tight font-bold tracking-tight">
          {mine.headline}
        </h2>
        <p className="text-base text-ink-muted">{mine.summary}</p>
        <div className="flex flex-wrap gap-3">
          <LinkButton
            href={tournamentRoutes.certificate(tournament.id)}
            variant="primary"
          >
            View certificate
          </LinkButton>
          <SampleButton label="Copy link to results" />
          <LinkButton href="/recordings" variant="ghost">
            Watch my rounds
          </LinkButton>
        </div>
      </section>
      <section className={card}>
        <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Your rounds
        </h2>
        <ul>
          {mine.rounds.map((round) => (
            <li
              key={round.label}
              className="flex justify-between gap-3 border-t border-border py-2 first:border-t-0"
            >
              <span className="text-base text-ink">{`${round.label} vs @${round.opponent}`}</span>
              <span
                className={cn(
                  'text-base font-strong',
                  round.result === 'Won' ? 'text-accent' : 'text-ink-muted',
                )}
              >
                {round.result}
              </span>
            </li>
          ))}
        </ul>
      </section>
      <section aria-label="Certificate preview" className="flex flex-col gap-3">
        <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Certificate preview
        </h2>
        <Certificate tournament={tournament} certificate={mine.certificate} />
      </section>
    </div>
  );
}
