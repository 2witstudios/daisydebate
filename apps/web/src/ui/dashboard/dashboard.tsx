import type { ReactNode } from 'react';
import { cn } from '../cn';
import { ActionTile } from './action-tile/action-tile';
import { tiles } from './tiles';
import type { SeasonGlance } from '../../features/leaderboard/season';
import { BetaOpenTeaser } from './beta-open-teaser/beta-open-teaser';

/**
 * Main-column composition of the home dashboard. Pure layout: owns the
 * interior gaps of the column; content owns its own appearance. The hero is
 * the page's: a visitor's waitlist join or a member's way into the Lobby. A
 * phone stops at the menu, and a visitor there sees only the join.
 */
export function Dashboard({
  audience,
  hero,
  liveNow,
  seasonGlance = null,
}: {
  readonly audience: 'visitor' | 'member';
  readonly hero: ReactNode;
  /** Who is live; the page reads it. */
  readonly liveNow: ReactNode;
  /** The Seasons note's reveal; null when no season is running. */
  readonly seasonGlance?: SeasonGlance | null;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8">
      {hero}
      <ul
        className={cn(
          'grid grid-cols-4 gap-4 max-wide:grid-cols-3 max-tiles:grid-cols-2 max-narrow:grid-cols-1 max-narrow:gap-3',
          audience === 'visitor' && 'max-narrow:hidden',
        )}
        aria-label="Debate destinations"
      >
        {tiles.map((tile) => (
          <li key={tile.href} className="min-w-0">
            <ActionTile
              {...tile}
              seasonGlance={
                tile.destination === 'seasons' ? seasonGlance : null
              }
            />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-dash-lower gap-4 max-compact:grid-cols-1 max-narrow:hidden">
        <BetaOpenTeaser />
        {liveNow}
      </div>
    </div>
  );
}
