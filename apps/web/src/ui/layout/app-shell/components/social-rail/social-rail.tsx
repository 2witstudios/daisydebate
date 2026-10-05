'use client';

import Link from 'next/link';
import { avatarSrc } from '../../../../assets';
import { Avatar } from '../../../../components/avatar/avatar';
import { Icon } from '../../../../components/icon/icon';
import { useUiState, useUiStore } from '../../../../store/store';
import type { DockState } from '../../../../store/state';
import { dispatch, transactions } from '../../../../transactions';
import type { ShellAccount } from '../../account';
import { EdgeTab } from '../edge-tab/edge-tab';
import {
  dockGroups,
  onlineNow,
  statusLabel,
  viewerStatus,
  type DockGroup,
} from './dock-people';

const control =
  'flex size-12 shrink-0 cursor-pointer items-center justify-center rounded-md text-ink-muted hover:bg-surface-overlay hover:text-ink';

/** What both views of the rail read. */
type ViewProps = {
  readonly username: string;
  readonly groups: readonly DockGroup[];
  readonly online: number;
  readonly setDock: (dock: DockState) => void;
};

/** Bell to the notifications page; the same control in both views. */
function Notifications() {
  return (
    <Link href="/notifications" aria-label="Notifications" className={control}>
      <Icon name="bell" size={20} />
    </Link>
  );
}

function Full({ username, groups, online, setDock }: ViewProps) {
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
      <header className="flex h-16 shrink-0 items-center gap-2 border-b border-border pr-2 pl-4">
        <Link
          href="/settings"
          aria-label={`Account settings for ${username}`}
          className="flex min-w-0 flex-1 items-center gap-3 text-ink no-underline hover:no-underline"
        >
          <Avatar name={username} presence={viewerStatus} size="md" />
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-bold">{username}</span>
            <span className="text-xs text-ink-muted">
              {statusLabel[viewerStatus]}
            </span>
          </span>
        </Link>
        <Notifications />
      </header>
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

function Strip({ username, groups, online, setDock }: ViewProps) {
  return (
    <div className="social-strip flex-col items-center gap-2 overflow-y-auto border-l border-border py-2">
      <EdgeTab
        side="left"
        label="Expand friends"
        expanded={false}
        icon="chevronLeft"
        controls="social-rail"
        onClick={() => setDock('open')}
      />
      <Link
        href="/settings"
        aria-label={`Account settings for ${username}`}
        className="flex size-12 shrink-0 items-center justify-center no-underline hover:no-underline"
      >
        <Avatar name={username} presence={viewerStatus} size="md" />
      </Link>
      <Notifications />
      <span aria-hidden="true" className="my-1 h-px w-8 bg-border" />
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

const visitorLink =
  'flex min-h-12 items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-bold whitespace-nowrap text-accent-ink no-underline hover:bg-accent-strong hover:no-underline max-compact:px-3';

/**
 * The right-hand column for someone without a member account: their way in
 * at its head, where a member's avatar is, and no friends.
 */
function AccountCorner({ account }: { readonly account: ShellAccount }) {
  const [href, label] =
    account.state === 'anonymous'
      ? ['/sign-in', 'Sign in']
      : ['/onboarding/username', 'Finish sign-up'];
  return (
    <aside
      aria-label="Account"
      className="account-corner border-l border-border bg-surface"
    >
      <div className="sticky top-0 flex h-16 items-center justify-center border-b border-border px-3 max-compact:px-0">
        <Link href={href} aria-label={label} className={visitorLink}>
          <Icon name="person" size={18} className="hidden max-compact:block" />
          <span className="max-compact:sr-only">{label}</span>
        </Link>
      </div>
    </aside>
  );
}

/**
 * The right rail for a signed-in member: you at the top (your account and
 * notifications), then your friends. Open, it is a panel beside the page on
 * a wide screen and over it on a narrower one; collapsed, it is a strip of
 * avatars with the control to open it again. Both views are always in the
 * markup and the layout shows one, so the page is right before any script.
 */
export function SocialRail({ account }: { readonly account: ShellAccount }) {
  const store = useUiStore();
  const users = useUiState((state) => state.collections.onlineUsers);
  if (account.state !== 'member') return <AccountCorner account={account} />;
  const setDock = (dock: DockState) =>
    dispatch(store, transactions.setDock, dock);
  const props = {
    username: account.username,
    groups: dockGroups(users),
    online: onlineNow(users),
    setDock,
  };
  return (
    <aside
      id="social-rail"
      aria-label="You and your friends"
      className="social-rail bg-surface"
    >
      <Full {...props} />
      <Strip {...props} />
    </aside>
  );
}
