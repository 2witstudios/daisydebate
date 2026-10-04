import type {
  EliminationData,
  Match,
} from '../../../features/tournaments/bracket';
import { Icon } from '../../components/icon/icon';
import { StatusLine } from '../../components/status-line/status-line';
import { LinkButton } from '../link-button/link-button';
import { MatchCard } from './match-card';

type Props = {
  readonly data: EliminationData;
  readonly viewerHandle: string | null;
};

const champion = (data: EliminationData): string | null => {
  const final = data.rounds.at(-1)?.matches[0];
  if (!final || final.winner === null) return null;
  return (final.winner === 'a' ? final.a : final.b)?.handle ?? null;
};

/** The bracket as columns, round by round, ending at the champion. Desktop. */
export function BracketTree({ data, viewerHandle }: Props) {
  const winner = champion(data);
  return (
    <div
      aria-label="Bracket"
      className="flex gap-4 overflow-x-auto rounded-lg border border-border bg-surface p-4 max-compact:hidden"
    >
      {data.rounds.map((round) => (
        <section
          key={round.label}
          className="flex min-w-0 flex-1 flex-col gap-3"
        >
          <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
            {round.label}
          </h2>
          <div className="flex flex-1 flex-col justify-around gap-4">
            {round.matches.map((match) => (
              <MatchCard
                key={match.id}
                match={match}
                viewerHandle={viewerHandle}
              />
            ))}
          </div>
        </section>
      ))}
      <section className="flex min-w-0 flex-1 flex-col gap-3">
        <h2 className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Champion
        </h2>
        <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center text-base text-ink-muted">
          <span className="text-gold">
            <Icon name="trophy" size={28} />
          </span>
          {winner ? (
            <p className="font-strong text-ink">{`@${winner}`}</p>
          ) : (
            <p>TBD</p>
          )}
        </div>
      </section>
    </div>
  );
}

const who = (slot: Match['a']): string =>
  slot ? `@${slot.handle} (seed ${slot.seed})` : 'to be decided';

function result(match: Match): string {
  if (match.state === 'live') return 'In progress';
  if (match.state === 'pending') return 'Not started';
  const winner = match.winner === 'a' ? match.a : match.b;
  return `@${winner?.handle ?? ''} won`;
}

/** Every match as a list by round: the phone layout, and a desktop view. */
export function RoundList({ data }: Props) {
  return (
    <div aria-label="Rounds" className="flex flex-col gap-4 max-compact:flex">
      {data.rounds.map((round) => (
        <section
          key={round.label}
          className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
        >
          <h2 className="px-4 py-3 text-xs font-bold tracking-widest text-ink-muted uppercase">
            {round.label}
          </h2>
          <ul>
            {round.matches.map((match) => (
              <li
                key={match.id}
                className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-4 py-3"
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <p className="text-base font-strong text-ink">
                    {match.label}
                  </p>
                  <p className="text-sm text-ink-muted">
                    {`${who(match.a)} vs ${who(match.b)}`}
                  </p>
                  <p className="text-xs text-ink-faint">
                    {match.judge
                      ? `Judge @${match.judge}${match.watching ? `. ${match.watching} watching` : ''}`
                      : (match.note ?? '')}
                  </p>
                </div>
                <p className="text-sm font-strong text-ink">
                  {match.state === 'live' ? (
                    <StatusLine tone="live">{result(match)}</StatusLine>
                  ) : (
                    result(match)
                  )}
                </p>
                {match.state === 'pending' ? null : (
                  <LinkButton
                    href={match.state === 'live' ? '/watch' : '/recordings'}
                    variant="ghost"
                  >
                    {match.state === 'live' ? 'Watch' : 'Recording'}
                  </LinkButton>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
