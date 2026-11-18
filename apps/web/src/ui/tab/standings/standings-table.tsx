'use client';

import { useState } from 'react';
import { matchesQuery } from '../../../features/tab/at-scale';
import type { StandingsTable as Read } from '../../../features/tab/standings';
import { buttonClass } from '../../components/button/button-class';
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
function Ranking({ table }: { readonly table: Read }) {
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

/** Every break is a separate ranking, with clear seeds and the tail folded away. */
export function StandingsTable({ table }: { readonly table: Read }) {
  const [query, setQuery] = useState('');
  const search = (
    <input
      type="search"
      aria-label="Find an entry or school"
      placeholder="Find an entry or school"
      value={query}
      onChange={(event) => setQuery(event.currentTarget.value)}
      className="min-h-12 rounded-sm border border-border bg-surface-raised px-3"
    />
  );
  if (table.rows.length < 30) return <Ranking table={table} />;
  return (
    <div className="flex flex-col gap-5">
      {search}
      {[table, ...table.divisions].map((line, index) => (
        <BreakRanking
          key={line.title}
          line={line}
          title={index === 0 ? 'Main break' : line.title}
          query={query}
        />
      ))}
    </div>
  );
}

function BreakRanking({
  line,
  title,
  query,
}: {
  readonly line: Read;
  readonly title: string;
  readonly query: string;
}) {
  const [expanded, setExpanded] = useState({ clear: false, tail: false });
  const seeds = line.breakAfter ?? 0;
  const firstOut = line.rows[seeds];
  const clear =
    firstOut === undefined
      ? 0
      : line.rows
          .slice(0, seeds)
          .filter(
            (row) =>
              row.wins > firstOut.wins ||
              (row.wins === firstOut.wins &&
                row.points !== null &&
                firstOut.points !== null &&
                row.points - firstOut.points >= 3),
          ).length;
  const rows = line.rows.filter((row, index) =>
    query !== ''
      ? matchesQuery(query, [row.entry, row.school])
      : (expanded.clear || index >= clear) &&
        (expanded.tail || index < seeds + 3),
  );
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-bold">
        {title} · top {seeds}
      </h2>
      {clear === 0 || query !== '' ? null : (
        <button
          type="button"
          aria-expanded={expanded.clear}
          onClick={() => setExpanded({ ...expanded, clear: !expanded.clear })}
          className={buttonClass('secondary')}
        >
          {expanded.clear ? 'Hide' : `Show ${clear}`} · Seeds 1 to {clear} clear
          of the line
        </button>
      )}
      <Ranking table={{ ...line, rows, divisions: [] }} />
      {line.rows.length <= seeds + 3 || query !== '' ? null : (
        <button
          type="button"
          aria-expanded={expanded.tail}
          onClick={() => setExpanded({ ...expanded, tail: !expanded.tail })}
          className={buttonClass('secondary')}
        >
          {line.rows.length - seeds - 3} more below ·{' '}
          {expanded.tail ? 'Hide' : `Show all ${line.rows.length}`}
        </button>
      )}
    </section>
  );
}
