import type { ReactNode } from 'react';
import {
  bracketTree,
  type EliminationData,
  type Match,
  type TreeNode,
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

/** Feeders on the left, joined by a trunk, then the match they lead to. */
function Branch({
  feeders,
  cardClass = 'bracket-card',
  children,
}: {
  readonly feeders: readonly ReactNode[];
  /** The width of the card at the end of this branch. */
  readonly cardClass?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-center">
      {feeders.length > 0 ? (
        <>
          <div className="flex flex-col">
            {feeders.map((feeder, index) => (
              <div key={index} className="bracket-feeder">
                {feeder}
              </div>
            ))}
          </div>
          <span aria-hidden="true" className="bracket-stub" />
        </>
      ) : null}
      <div className={cardClass}>{children}</div>
    </div>
  );
}

function MatchBranch({
  node,
  viewerHandle,
}: {
  readonly node: TreeNode;
  readonly viewerHandle: string | null;
}) {
  return (
    <Branch
      feeders={node.feeders.map((feeder) => (
        <MatchBranch
          key={feeder.match.id}
          node={feeder}
          viewerHandle={viewerHandle}
        />
      ))}
    >
      <MatchCard match={node.match} viewerHandle={viewerHandle} />
    </Branch>
  );
}

/** The end of the tree: who won the final, or that it is still to come. */
function ChampionCard({ winner }: { readonly winner: string | null }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-border bg-surface-raised p-3 text-center">
      <span className="text-gold">
        <Icon name="trophy" size={24} />
      </span>
      <p className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Champion
      </p>
      <p className={winner ? 'font-strong text-ink' : 'text-sm text-ink-muted'}>
        {winner ? `@${winner}` : 'Decided after the final'}
      </p>
    </div>
  );
}

/**
 * The bracket as one tree: the quarterfinals on the left feed the semifinals,
 * which feed the final, which ends at the champion. Desktop. A bracket that
 * does not narrow to one final falls back to the list of rounds.
 */
export function BracketTree({ data, viewerHandle }: Props) {
  const root = bracketTree(data.rounds);
  if (!root) return <RoundList data={data} viewerHandle={viewerHandle} />;
  return (
    <div
      aria-label="Bracket"
      className="overflow-x-auto rounded-lg border border-border bg-surface p-4 max-compact:hidden"
    >
      <Branch
        cardClass="bracket-end"
        feeders={[
          <MatchBranch
            key={root.match.id}
            node={root}
            viewerHandle={viewerHandle}
          />,
        ]}
      >
        <ChampionCard winner={champion(data)} />
      </Branch>
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
