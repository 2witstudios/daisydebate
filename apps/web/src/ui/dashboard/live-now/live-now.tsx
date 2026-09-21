'use client';

import Link from 'next/link';
import { Avatar } from '../../components/avatar/avatar';
import { Badge } from '../../components/badge/badge';
import { Button } from '../../components/button/button';
import { Panel } from '../../components/panel/panel';
import { Icon } from '../../components/icon/icon';
import { useUiState } from '../../store/store';
import { avatarSrc } from '../../assets';
import styles from './live-now.module.css';

export function LiveNow() {
  const liveDebates = useUiState((state) => state.collections.liveDebates);
  return (
    <Panel
      title={
        <span className={styles.titleRow}>
          <span className={styles.liveDot} aria-hidden="true" />
          Live Now
        </span>
      }
      action={
        <Button variant="ghost" aria-label="See all live debates">
          See All
        </Button>
      }
    >
      <ul className={styles.list}>
        {liveDebates.map((debate) => (
          <li key={debate.topic}>
            <Link href="/watch" className={styles.match}>
              <p className={styles.resolution}>
                <Badge tone="live">Live</Badge>
                <span className={styles.resolutionText}>{debate.topic}</span>
              </p>
              <div className={styles.matchup}>
                <span className={styles.competitor}>
                  <Avatar
                    name={debate.challenger}
                    src={avatarSrc(debate.challenger)}
                    size="md"
                  />
                  <span className={styles.who}>
                    <span className={styles.name}>{debate.challenger}</span>
                    <span className={styles.rating}>
                      ({debate.challengerRating})
                    </span>
                  </span>
                </span>
                <span className={styles.vs} aria-hidden="true">
                  vs
                </span>
                <span className={`${styles.competitor} ${styles.away}`}>
                  <span className={styles.who}>
                    <span className={styles.name}>{debate.defender}</span>
                    <span className={styles.rating}>
                      ({debate.defenderRating})
                    </span>
                  </span>
                  <Avatar
                    name={debate.defender}
                    src={avatarSrc(debate.defender)}
                    size="md"
                  />
                </span>
              </div>
              <p className={styles.meta}>
                <Icon name="users" size={14} />
                <span className={styles.metaValue}>{debate.viewers}</span>
                watching
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
