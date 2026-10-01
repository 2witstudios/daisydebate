import {
  resultsGrid,
  standings,
  type GridCell,
  type RobinData,
} from '../../../features/tournaments/bracket';
import { LinkButton } from '../link-button/link-button';
import { cn } from '../../cn';

const cell = 'px-3 py-2 text-base tabular-nums';
const head =
  'px-3 py-2 text-2xs font-bold tracking-wider text-ink-faint uppercase';

function Handle({
  handle,
  viewerHandle,
}: {
  readonly handle: string;
  readonly viewerHandle: string | null;
}) {
  return (
    <span className="flex items-center gap-2 font-strong text-ink">
      {`@${handle}`}
      {handle === viewerHandle ? (
        <span className="text-xs font-bold text-accent uppercase">You</span>
      ) : null}
    </span>
  );
}

export function StandingsTable({
  data,
  viewerHandle,
}: {
  readonly data: RobinData;
  readonly viewerHandle: string | null;
}) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
        <table className="w-full text-left">
          <caption className="sr-only">Standings</caption>
          <thead>
            <tr>
              <th scope="col" className={head}>
                Rank
              </th>
              <th scope="col" className={head}>
                Debater
              </th>
              <th scope="col" className={head}>
                Won
              </th>
              <th scope="col" className={head}>
                Lost
              </th>
              <th scope="col" className={head}>
                Opponent wins
              </th>
              <th scope="col" className={cn(head, 'max-compact:hidden')}>
                Next round
              </th>
            </tr>
          </thead>
          <tbody>
            {standings(data).map((row) => (
              <tr key={row.handle} className="border-t border-border">
                <td className={cell}>{row.rank}</td>
                <td className={cell}>
                  <Handle handle={row.handle} viewerHandle={viewerHandle} />
                </td>
                <td className={cell}>{row.won}</td>
                <td className={cell}>{row.lost}</td>
                <td className={cell}>{row.opponentWins}</td>
                <td className={cn(cell, 'text-ink-muted max-compact:hidden')}>
                  {row.next
                    ? `R${row.next.round} vs @${row.next.opponent}${data.times[row.next.round] ? `, ${data.times[row.next.round]}` : ''}`
                    : ''}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-faint">
        Ranked by rounds won, then by the total wins of the debaters met, then
        by handle. The tiebreak order is a sample; the organizer sets the real
        one.
      </p>
    </div>
  );
}

const cellText = (value: GridCell): string => {
  switch (value.kind) {
    case 'won':
      return 'W';
    case 'lost':
      return 'L';
    case 'round':
      return `R${value.number}`;
    case 'self':
      return '–';
    case 'none':
      return '';
  }
};

export function ResultsGrid({ data }: { readonly data: RobinData }) {
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-border bg-surface shadow-1">
        <table className="w-full text-center">
          <caption className="sr-only">Results grid</caption>
          <thead>
            <tr>
              <td />
              {data.handles.map((handle) => (
                <th key={handle} scope="col" className={head}>
                  {handle.slice(-1).toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resultsGrid(data).map((row) => (
              <tr key={row.handle} className="border-t border-border">
                <th
                  scope="row"
                  className={cn(cell, 'text-left font-strong text-ink')}
                >
                  {`@${row.handle}`}
                </th>
                {row.cells.map((value, index) => (
                  <td
                    key={data.handles[index]}
                    className={cn(
                      cell,
                      value.kind === 'won' && 'font-strong text-accent',
                      value.kind === 'lost' && 'text-ink-muted',
                      value.kind === 'round' && 'text-ink-faint',
                    )}
                  >
                    {cellText(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-sm text-ink-faint">
        W and L are results. R3 to R7 show the round each pair will meet. Every
        debater meets every other debater once.
      </p>
    </div>
  );
}

export function RobinRounds({ data }: { readonly data: RobinData }) {
  return (
    <div aria-label="Rounds" className="flex flex-col gap-4">
      {[...data.rounds]
        .filter((round) => round.state !== 'scheduled')
        .reverse()
        .map((round) => (
          <section
            key={round.number}
            className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
          >
            <div className="flex items-center justify-between px-4 py-3">
              <h2 className="text-md font-strong text-ink">{`Round ${round.number}`}</h2>
              <p className="text-sm text-ink-muted">{round.note}</p>
            </div>
            <ul>
              {round.tables.map((t) => (
                <li
                  key={t.table}
                  className="flex items-center justify-between gap-3 border-t border-border px-4 py-3"
                >
                  <span className="text-sm text-ink-faint">{`Table ${t.table}`}</span>
                  <span className="min-w-0 flex-1 text-base text-ink">
                    {t.winner === null ? (
                      `@${t.a} vs @${t.b}`
                    ) : (
                      <>
                        <b className="font-strong">{`@${t[t.winner]}`}</b>
                        {` beat @${t[t.winner === 'a' ? 'b' : 'a']}`}
                      </>
                    )}
                  </span>
                  {t.winner === null ? null : (
                    <LinkButton href="/recordings" variant="ghost">
                      Recording
                    </LinkButton>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      <p className="text-sm text-ink-faint">
        Rounds 4 to 7 are scheduled on later days. Pairings release before each
        round.
      </p>
    </div>
  );
}
