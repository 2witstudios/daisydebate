import { HeroBanner } from './hero-banner/hero-banner';
import { ActionTile } from './action-tile/action-tile';
import { tiles } from './tiles';
import { FeaturedTournament } from './featured-tournament/featured-tournament';
import { LiveNow } from './live-now/live-now';
import styles from './dashboard.module.css';

/**
 * Main-column composition of the home dashboard. Pure layout: owns the
 * interior gaps of the column; content owns its own appearance.
 */
export function Dashboard() {
  return (
    <div className={styles.column}>
      <HeroBanner />
      <ul className={styles.tiles} aria-label="Debate destinations">
        {tiles.map((tile) => (
          <li key={tile.href} className={styles.tileCell}>
            <ActionTile {...tile} />
          </li>
        ))}
      </ul>
      <div className={styles.lower}>
        <FeaturedTournament />
        <LiveNow />
      </div>
    </div>
  );
}
