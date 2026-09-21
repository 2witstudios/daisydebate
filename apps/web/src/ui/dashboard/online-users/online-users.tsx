'use client';

import { Avatar } from '../../components/avatar/avatar';
import { IconButton } from '../../components/icon-button/icon-button';
import { Panel } from '../../components/panel/panel';
import { Button } from '../../components/button/button';
import { Tier } from '../../types/tier/tier';
import { useUiState } from '../../store/store';
import { avatarSrc } from '../../assets';
import styles from './online-users.module.css';

export function OnlineUsers() {
  const onlineCount = useUiState((state) => state.resources.onlineCount);
  const onlineUsers = useUiState((state) => state.collections.onlineUsers);
  return (
    <Panel
      icon="person"
      title={`Online (${onlineCount.toLocaleString('en-US')})`}
      action={
        <Button variant="ghost" aria-label="See all online users">
          See All
        </Button>
      }
    >
      <ul className={styles.list}>
        {onlineUsers.map((user) => (
          <li key={user.name} className={styles.user}>
            <Avatar
              name={user.name}
              src={avatarSrc(user.name)}
              presence={user.presence}
              size="md"
            />
            <span className={styles.meta}>
              <span className={styles.name}>{user.name}</span>
              <span className={styles.tier}>{Tier.label[user.tier]}</span>
            </span>
            <IconButton
              name="swords"
              label={`Challenge ${user.name}`}
              className={styles.challenge}
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
