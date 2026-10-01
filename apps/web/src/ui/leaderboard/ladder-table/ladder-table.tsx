import Link from 'next/link';
import type { LadderView } from '../../../features/leaderboard/ladder-view';
import {
  clearFiltersHref,
  everyoneHref,
  pageHref,
  seasonHref,
  type LadderQuery,
} from '../../../features/leaderboard/query';
import { isClosed } from '../../../features/leaderboard/season';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { LadderRow } from '../ladder-row/ladder-row';
import {
  ladderColumnClass,
  ladderGridClass,
} from '../ladder-row/ladder-row-class';
import { EmptyLadder } from '../ladder-states/ladder-states';
import { Podium } from '../podium/podium';

export type LadderTableProps = {
  readonly view: LadderView;
  readonly query: LadderQuery;
};

const heading = cn(
  ladderGridClass,
  'px-5 py-3 text-2xs font-bold tracking-wider text-ink-faint uppercase max-compact:hidden',
);

const pagerLink = cn(
  buttonClass('secondary'),
  'no-underline hover:no-underline',
);
const pagerOff = cn(buttonClass('secondary'), 'pointer-events-none opacity-60');

function Pager({ view, query }: LadderTableProps) {
  const { page, pageCount } = view;
  return (
    <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-3 max-compact:px-4">
      <p className="text-sm text-ink-muted">
        {`${view.total} ${view.total === 1 ? 'debater' : 'debaters'} · Page ${page} of ${pageCount}`}
      </p>
      {view.around ? null : (
        <nav aria-label="Pages" className="flex gap-2">
          {page > 1 ? (
            <Link
              href={pageHref(query, page - 1)}
              className={pagerLink}
              rel="prev"
            >
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className={pagerOff}>
              Previous
            </span>
          )}
          {page < pageCount ? (
            <Link
              href={pageHref(query, page + 1)}
              className={pagerLink}
              rel="next"
            >
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className={pagerOff}>
              Next
            </span>
          )}
        </nav>
      )}
    </div>
  );
}

/** The podium and the ranked list, or the ladder's empty state. */
export function LadderTable({ view, query }: LadderTableProps) {
  const closed = isClosed(view.season);
  const before = view.seasons.find(
    (season) => season.id === view.season.id - 1,
  );
  return (
    <>
      {view.podium.length > 0 ? (
        <Podium rows={view.podium} closed={closed} />
      ) : null}
      <section
        aria-label="Ladder"
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
      >
        <div className={heading} aria-hidden="true">
          <span className={ladderColumnClass('rank')}>Rank</span>
          <span className={ladderColumnClass('name')}>Debater</span>
          <span className={ladderColumnClass('band')}>Band</span>
          <span className={ladderColumnClass('rating')}>Rating</span>
          <span className={ladderColumnClass('record')}>W–L</span>
          <span className={ladderColumnClass('move')}>
            {closed ? 'Season' : '7 days'}
          </span>
        </div>
        {view.around ? (
          <p className="border-t border-border bg-surface-overlay px-5 py-2 text-sm text-ink-muted">
            {view.gapNote}
          </p>
        ) : null}
        {view.empty === 'no' ? (
          <ul>
            {view.rows.map((row) => (
              <LadderRow key={row.key} row={row} closed={closed} />
            ))}
          </ul>
        ) : (
          <EmptyLadder
            kind={view.empty}
            provisionalHits={view.provisionalHits}
            clearHref={clearFiltersHref(query)}
            everyoneHref={everyoneHref(query)}
            previousSeasonHref={before ? seasonHref(before.id) : null}
            previousSeason={before?.id ?? null}
          />
        )}
        <Pager view={view} query={query} />
      </section>
    </>
  );
}
