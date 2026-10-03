'use client';

import Link from 'next/link';
import { avatarSrc } from '../../../../assets';
import { Avatar } from '../../../../components/avatar/avatar';
import { Icon } from '../../../../components/icon/icon';
import { PresenceDot } from '../../../../components/presence-dot/presence-dot';
import { useUiState } from '../../../../store/store';
import { useDock } from '../dock/use-dock';
import type { ShellAccount } from '../topbar/topbar';
import {
  dockGroups,
  onlineNow,
  statusLabel,
  viewerStatus,
} from './dock-people';

/**
 * The friends column on the right: who is around, what you can do with each,
 * and your own status beneath a plain header, with a chevron to collapse it. On a wide
 * screen it sits beside the page, which does not change width while it is
 * open or closed; narrower than that it overlays the page when opened. It is
 * where a messenger can go. Only for a signed-in member.
 */
export function ChatDock({ account }: { readonly account: ShellAccount }) {
  const users = useUiState((state) => state.collections.onlineUsers);
  const { setDock } = useDock();
  if (account.state !== 'member') return null;
  return (
    <aside
      id="friends-dock"
      aria-label="Friends"
      className="dock-panel flex-col gap-4 overflow-y-auto border-l border-border bg-surface px-3 py-4"
    >
      <header className="flex items-center gap-2 px-2">
        <h2 className="text-sm font-strong text-ink">Friends</h2>
        <span className="flex-1 text-sm text-ink-faint tabular-nums">
          {onlineNow(users)}
        </span>
        <button
          type="button"
          aria-label="Close friends"
          onClick={() => setDock('closed')}
          className="cursor-pointer rounded-md p-1 text-ink-faint hover:bg-surface-overlay hover:text-ink"
        >
          <Icon name="chevronRight" size={16} />
        </button>
      </header>
      <p className="-mt-2 flex items-center gap-2 px-2 text-xs text-ink-faint">
        <PresenceDot presence={viewerStatus} />
        {`You are ${statusLabel[viewerStatus].toLowerCase()}`}
      </p>
      {dockGroups(users).map((group) => (
        <div key={group.status} className="flex flex-col">
          <h3 className="px-2 pb-1 text-xs text-ink-faint">{group.label}</h3>
          <ul className="flex flex-col">
            {group.people.map((person) => (
              <li
                key={person.name}
                className="flex min-h-10 items-center gap-3 rounded-md px-2 hover:bg-surface-overlay"
              >
                <Avatar
                  name={person.name}
                  src={avatarSrc(person.name)}
                  presence={person.status}
                  size="sm"
                  nameVisible
                />
                <Link
                  href={person.profileHref}
                  className="min-w-0 flex-1 truncate text-sm text-ink no-underline hover:no-underline"
                >
                  {person.name}
                </Link>
                {person.action ? (
                  <Link
                    href={person.action.href}
                    className="text-xs text-ink-faint no-underline hover:text-accent hover:no-underline"
                  >
                    {person.action.label}
                  </Link>
                ) : null}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </aside>
  );
}
