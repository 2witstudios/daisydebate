'use client';

import { SearchInput } from '../../../../components/search-input/search-input';
import { IconButton } from '../../../../components/icon-button/icon-button';
import { Avatar } from '../../../../components/avatar/avatar';
import { PresenceDot } from '../../../../components/presence-dot/presence-dot';
import { Stat } from '../../../../components/stat/stat';
import { Icon } from '../../../../components/icon/icon';
import { Tier } from '../../../../types/tier/tier';
import { useUiState } from '../../../../store/store';
import { avatarSrc } from '../../../../assets';
import styles from './topbar.module.css';

/** The Daisy mark: eight petals around a solid disc. Filled, not stroked. */
function BrandMark() {
  return (
    <svg viewBox="0 0 24 24" width={18} height={18} aria-hidden="true">
      <g fill="currentColor">
        {[0, 45, 90, 135, 180, 225, 270, 315].map((angle) => (
          <ellipse
            key={angle}
            cx="12"
            cy="5.1"
            rx="2.3"
            ry="3.9"
            transform={`rotate(${angle} 12 12)`}
          />
        ))}
      </g>
      <circle cx="12" cy="12" r="2.4" fill="var(--accent-text)" />
    </svg>
  );
}

export function Topbar() {
  // Selectors return primitives or stable references — never fresh literals.
  const notificationsCount = useUiState(
    (state) => state.resources.notificationsCount,
  );
  const viewer = useUiState((state) => state.resources.viewer);
  return (
    <header className={styles.topbar}>
      <a href="/" className={styles.brand}>
        <span className={styles.logo} aria-hidden="true">
          <BrandMark />
        </span>
        <span className={styles.wordmark}>Daisy</span>
        <span className={styles.tagline}>
          Sharper minds.
          <br />A brighter world.
        </span>
      </a>
      <div className={styles.search}>
        <SearchInput />
      </div>
      <div className={styles.actions}>
        <span className={styles.bell}>
          <IconButton name="bell" label="Notifications" />
          {notificationsCount > 0 ? (
            <span className={styles.count} aria-hidden="true">
              {notificationsCount}
            </span>
          ) : null}
        </span>
        <button type="button" className={styles.profile}>
          <Avatar name={viewer.name} src={avatarSrc(viewer.name)} size="md" />
          <span className={styles.profileMeta}>
            <span className={styles.profileNameRow}>
              <span className={styles.profileName}>{viewer.name}</span>
              <PresenceDot presence="online" />
            </span>
            <span className={styles.profileStats}>
              <Stat icon="chart" value={viewer.rating} />
              <span className={styles.tier}>
                <Icon name="gem" size={13} />
                {Tier.label[viewer.tier]}
              </span>
            </span>
          </span>
          <Icon name="chevronDown" size={16} className={styles.chevron} />
        </button>
      </div>
    </header>
  );
}
