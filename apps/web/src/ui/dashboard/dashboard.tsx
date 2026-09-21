import { HeroBanner } from './hero-banner/hero-banner';
import { ActionTile } from './action-tile/action-tile';
import { tiles } from './tiles';
import { FeaturedTournament } from './featured-tournament/featured-tournament';
import { LiveNow } from './live-now/live-now';

/**
 * Main-column composition of the home dashboard. Pure layout: owns the
 * interior gaps of the column; content owns its own appearance.
 */
export function Dashboard() {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8">
      <HeroBanner />
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
        <FeaturedTournament />
        <LiveNow />
      </div>
    </div>
  );
}
