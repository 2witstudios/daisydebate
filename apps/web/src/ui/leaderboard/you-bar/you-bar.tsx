import Link from 'next/link';
import type { ReactNode } from 'react';
import type { LadderView } from '../../../features/leaderboard/ladder-view';
import {
  bandText,
  changeText,
  recordText,
} from '../../../features/leaderboard/labels';
import {
  leaderboardDestinations,
  signInToSeeRankHref,
} from '../../../features/leaderboard/actions';
import {
  ladderHref,
  scopeHref,
  type LadderQuery,
} from '../../../features/leaderboard/query';
import { isClosed } from '../../../features/leaderboard/season';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { BloomGlyph } from '../bloom-glyph/bloom-glyph';
import { moveClass } from '../ladder-row/ladder-row-class';

export type YouBarProps = {
  readonly view: LadderView;
  readonly query: LadderQuery;
  /** Who is signed in; shown on the bar. */
  readonly username: string | null;
};

const link = 'no-underline hover:no-underline';
const secondary = cn(buttonClass('secondary'), link, 'whitespace-nowrap');
const primary = cn(buttonClass('primary'), link, 'whitespace-nowrap');

function Bar({ children }: { readonly children: ReactNode }) {
  return (
    <div
      role="region"
      aria-label="Your standing"
      className="sticky bottom-0 z-10 -mx-6 border-t border-border-strong bg-surface px-6 py-3 shadow-2 max-compact:-mx-4 max-compact:px-4"
    >
      <div className="mx-auto flex max-w-dash-column flex-wrap items-center gap-x-4 gap-y-3">
        {children}
      </div>
    </div>
  );
}

/** Your line on the ladder, pinned to the bottom of the page. */
export function YouBar({ view, query, username }: YouBarProps) {
  const { pinned } = view;
  const closed = isClosed(view.season);
  if (pinned.kind === 'signed-out')
    return (
      <Bar>
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="font-bold">See where you rank</span>
          <span className="text-sm text-ink-muted">
            The ladder is public. Sign in to see your own rank.
          </span>
        </div>
        <Link href={signInToSeeRankHref(ladderHref(query))} className={primary}>
          Sign in
        </Link>
      </Bar>
    );
  if (pinned.kind === 'absent')
    return (
      <Bar>
        <p className="min-w-0 flex-1 text-base text-ink-muted">
          You have no ranked debates in this season.
        </p>
        {closed ? null : (
          <Link href={leaderboardDestinations.findMatch} className={primary}>
            Find a match
          </Link>
        )}
      </Bar>
    );
  const scope = view.around ? 'top' : 'around';
  const toggle = (
    <Link href={scopeHref(query, scope)} className={secondary}>
      {view.around ? 'Show the top' : 'Show around me'}
    </Link>
  );
  if (pinned.kind === 'provisional')
    return (
      <Bar>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="font-bold">
            You are provisional{' '}
            <span className="font-book text-ink-muted tabular-nums">{`rating ${pinned.row.rating}?`}</span>
          </span>
          <progress
            value={pinned.played}
            max={pinned.played + pinned.remaining}
            aria-label="Ranked debates toward a rank"
            className="h-2 w-full accent-accent"
          />
          <span className="text-sm text-ink-muted">
            {`Provisional. ${pinned.played} of ${pinned.played + pinned.remaining} ranked debates, ${pinned.remaining} more to place you.`}
          </span>
        </div>
        {toggle}
        {closed ? null : (
          <Link href={leaderboardDestinations.findMatch} className={primary}>
            Find a match
          </Link>
        )}
      </Bar>
    );
  const { row } = pinned;
  return (
    <Bar>
      <span className="min-w-16 font-display text-2xl font-bold tabular-nums">{`#${pinned.rank}`}</span>
      <BloomGlyph bloom={row.bloom} size={32} />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="font-bold">
          {username ? `@${username} ` : ''}
          <Badge tone="accent">You</Badge>
        </span>
        <span className="text-sm text-ink-muted tabular-nums">
          {`${closed ? 'Final · ' : ''}${bandText(row)} · ${recordText(row)} W–L`}
        </span>
      </div>
      <span className="font-display text-xl font-bold tabular-nums">
        {row.rating}
      </span>
      <span
        className={cn(
          'text-sm font-strong tabular-nums',
          moveClass(row.change.kind),
        )}
      >
        {changeText(row.change, closed)}
      </span>
      {toggle}
      <Link href={pinned.jumpHref} className={secondary}>
        Jump to my rank
      </Link>
    </Bar>
  );
}
