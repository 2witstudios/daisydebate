import type { ReactNode } from 'react';
import { ActionTile } from './action-tile/action-tile';
import { tiles } from './tiles';
import { FeaturedTournament } from './featured-tournament/featured-tournament';
import { LiveNow } from './live-now/live-now';
import { ComingSoonCard } from './coming-soon-card/coming-soon-card';
import { explainerHref, launched } from '../../features/coming-soon/launch';

/**
 * Main-column composition of the home dashboard. Pure layout: owns the
 * interior gaps of the column; content owns its own appearance. The hero is
 * the page's: a visitor's waitlist join or a member's way into the Lobby.
 */
export function Dashboard({ hero }: { readonly hero: ReactNode }) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8">
      {hero}
      <ul
        className="grid grid-cols-4 gap-4 max-wide:grid-cols-3 max-tiles:grid-cols-2 max-tiny:grid-cols-1"
        aria-label="Debate destinations"
      >
        {tiles.map((tile) => (
          <li key={tile.href} className="min-w-0">
            <ActionTile {...tile} />
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-dash-lower gap-4 max-compact:grid-cols-1">
        {launched.tournaments ? (
          <FeaturedTournament />
        ) : (
          <ComingSoonCard
            title="Featured tournament"
            href={explainerHref('tournaments')}
          />
        )}
        {launched.watch ? (
          <LiveNow />
        ) : (
          <ComingSoonCard title="Live now" href={explainerHref('watch')} />
        )}
      </div>
    </div>
  );
}
