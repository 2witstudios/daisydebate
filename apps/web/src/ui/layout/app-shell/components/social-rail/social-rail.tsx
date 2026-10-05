'use client';

import Link from 'next/link';
import { avatarSrc } from '../../../../assets';
import { Avatar } from '../../../../components/avatar/avatar';
import { useUiState, useUiStore } from '../../../../store/store';
import type { DockState } from '../../../../store/state';
import { dispatch, transactions } from '../../../../transactions';
import type { ShellAccount } from '../../account';
import { EdgeTab } from '../edge-tab/edge-tab';
import { dockGroups, onlineNow, type DockGroup } from './dock-people';

/** What both views of the rail read. */
type ViewProps = {
  readonly groups: readonly DockGroup[];
  readonly online: number;
  readonly setDock: (dock: DockState) => void;
};

function Full({ groups, online, setDock }: ViewProps) {
  return (
    <div className="social-full flex-col border-l border-border bg-surface">
      <EdgeTab
        side="left"
        label="Collapse friends"
        expanded
        icon="chevronRight"
        controls="social-rail"
        onClick={() => setDock('closed')}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-3 py-4">
        <h2 className="flex items-baseline gap-2 px-2 text-sm font-strong text-ink">
          Friends
          <span className="text-xs font-semibold text-ink-faint tabular-nums">
            {`${online} online`}
          </span>
        </h2>
        {groups.map((group) => (
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
      </div>
    </div>
  );
}

function Strip({ groups, online, setDock }: ViewProps) {
  return (
    <div className="social-strip flex-col items-center gap-2 overflow-y-auto border-l border-border py-4">
      <EdgeTab
        side="left"
        label="Expand friends"
        expanded={false}
        icon="chevronLeft"
        controls="social-rail"
        onClick={() => setDock('open')}
      />
      <span className="text-xs font-bold text-online tabular-nums">
        {`${online} on`}
      </span>
      <ul className="flex list-none flex-col items-center gap-2">
        {groups.flatMap((group) =>
          group.people.map((person) => (
            <li key={person.name}>
              <Link
                href={person.profileHref}
                aria-label={person.name}
                className="flex size-12 items-center justify-center no-underline hover:no-underline"
              >
                <Avatar
                  name={person.name}
                  src={avatarSrc(person.name)}
                  presence={person.status}
                  size="sm"
                />
              </Link>
            </li>
          )),
        )}
      </ul>
    </div>
  );
}

/**
 * The right rail for a signed-in member: their friends, under the top bar
 * that holds their account. Open, it is a panel beside the page on a wide
 * screen and over it on a narrower one; collapsed, it is a strip of avatars.
 * Each view has its tab to switch to the other. Both views are always in
 * the markup and the layout shows one, so the page is right before any
 * script.
 */
export function SocialRail({ account }: { readonly account: ShellAccount }) {
  const store = useUiStore();
  const users = useUiState((state) => state.collections.onlineUsers);
  if (account.state !== 'member') return null;
  const setDock = (dock: DockState) =>
    dispatch(store, transactions.setDock, dock);
  const props = {
    groups: dockGroups(users),
    online: onlineNow(users),
    setDock,
  };
  return (
    <aside
      id="social-rail"
      aria-label="Friends"
      className="social-rail bg-surface"
    >
      <Full {...props} />
      <Strip {...props} />
    </aside>
  );
}
