'use client';

import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { Panel } from '../../components/panel/panel';
import { useUiState } from '../../store/store';
import { avatarSrc } from '../../assets';
import styles from './activity-feed.module.css';

export function ActivityFeed() {
  const activities = useUiState((state) => state.collections.activities);
  return (
    <Panel icon="bolt" title="Recent Activity">
      <ul className={styles.list}>
        {activities.map((activity) => (
          <li key={activity.headline} className={styles.item}>
            {activity.actor ? (
              <Avatar
                name={activity.actor}
                src={avatarSrc(activity.actor)}
                size="sm"
              />
            ) : (
              <span className={styles.systemIcon} aria-hidden="true">
                <Icon name="trophy" size={13} />
              </span>
            )}
            <span className={styles.text}>
              <span className={styles.headline}>{activity.headline}</span>
              <span className={styles.meta}>{activity.meta}</span>
            </span>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
