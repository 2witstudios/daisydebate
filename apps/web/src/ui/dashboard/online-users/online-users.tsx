'use client';

import { Avatar } from '../../components/avatar/avatar';
import { IconButton } from '../../components/icon-button/icon-button';
import { Panel } from '../../components/panel/panel';
import { Button } from '../../components/button/button';
import { Tier } from '../../types/tier/tier';
import { useUiState } from '../../store/store';
import { avatarSrc } from '../../assets';

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
      <ul className="flex flex-col gap-3">
        {onlineUsers.map((user) => (
          <li key={user.name} className="group flex items-center gap-3">
            <Avatar
              name={user.name}
              src={avatarSrc(user.name)}
              presence={user.presence}
              size="md"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-roster-inset">
              <span className="truncate text-sm leading-tight font-bold">
                {user.name}
              </span>
              <span className="text-xs tracking-wide text-ink-muted">
                {Tier.label[user.tier]}
              </span>
            </span>
            <IconButton
              name="swords"
              label={`Challenge ${user.name}`}
              tone="reveal"
            />
          </li>
        ))}
      </ul>
    </Panel>
  );
}
