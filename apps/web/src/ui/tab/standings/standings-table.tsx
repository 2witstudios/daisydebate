import type { StandingsTable as Read } from '../../../features/tab/standings';
import { cn } from '../../cn';
import { eyebrowClass } from '../list-card/list-card';

const cell = 'px-3 py-2 text-left text-sm';
const headings = [
  'Seed',
  'Entry',
  'Wins',
  'Points',
  'Opp. wins',
  'Rating',
  'Placed here because',
];

/**
 * An event's standings: each entry with the tiebreak that put it on its
 * line, and the break line where a break is set.
 */
export function StandingsTable({ table }: { readonly table: Read }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border bg-surface-raised">
      <table className="w-full border-collapse">
        <thead>
          <tr className="bg-surface">
            {headings.map((heading) => (
              <th key={heading} scope="col" className={cn(cell, eyebrowClass)}>
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {table.rows.map((row) => (
            <tr
              key={row.seed}
              className={cn(
                'border-t border-border',
                row.seed - 1 === table.breakAfter && 'border-t-3 border-ink',
              )}
            >
              <td className={cn(cell, 'tabular-nums')}>{row.seed}</td>
              <th scope="row" className={cn(cell, 'font-book')}>
                <strong className="font-strong">{row.entry}</strong> ·{' '}
                {row.school}
              </th>
              <td className={cn(cell, 'tabular-nums')}>{row.wins}</td>
              <td className={cn(cell, 'tabular-nums')}>{row.points}</td>
              <td className={cn(cell, 'tabular-nums')}>{row.opponentWins}</td>
              <td className={cn(cell, 'tabular-nums')}>
                {row.rating ?? 'Unrated'}
              </td>
              <td className={cn(cell, row.decisive && 'font-strong')}>
                {row.seed - 1 === table.breakAfter ? (
                  <span className="sr-only">
                    Break line: below here does not advance.{' '}
                  </span>
                ) : null}
                {row.reason}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
