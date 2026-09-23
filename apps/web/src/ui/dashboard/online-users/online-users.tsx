'use client';

import Link from 'next/link';
import { Avatar } from '../../components/avatar/avatar';
import { Icon } from '../../components/icon/icon';
import { Panel } from '../../components/panel/panel';
import { buttonClass } from '../../components/button/button-class';
import { iconButtonClass } from '../../components/icon-button/icon-button-class';
import { label } from '../../types/tier/tier';
import { useUiState } from '../../store/store';
import { avatarSrc } from '../../assets';

export function OnlineUsers() {
  const onlineCount = useUiState((state) => state.resources.onlineCount);
  const onlineUsers = useUiState((state) => state.collections.onlineUsers);
  return (
    <Panel
      title={`Online (${onlineCount.toLocaleString('en-US')})`}
      action={
        <Link
          href="/lobby"
          className={buttonClass('ghost')}
          aria-label="See all online users"
        >
          See All
        </Link>
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
              nameVisible
            />
            <span className="flex min-w-0 flex-1 flex-col gap-roster-inset">
              <span className="truncate text-sm leading-tight font-bold">
                {user.name}
              </span>
              <span className="text-xs tracking-wide text-ink-muted">
                {label[user.tier]}
              </span>
            </span>
            <Link
              href="/play"
              className={iconButtonClass('reveal')}
              aria-label={`Challenge ${user.name}`}
              title={`Challenge ${user.name}`}
            >
              <Icon name="swords" size={18} />
            </Link>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
