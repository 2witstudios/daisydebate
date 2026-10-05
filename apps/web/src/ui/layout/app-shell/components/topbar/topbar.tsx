import Link from 'next/link';
import { Avatar } from '../../../../components/avatar/avatar';
import { DaisyLogo } from '../../../../components/daisy-mark/daisy-mark';
import { Icon } from '../../../../components/icon/icon';
import type { ShellAccount } from '../../account';
import { statusLabel, viewerStatus } from '../social-rail/dock-people';

const bell =
  'flex size-12 shrink-0 items-center justify-center rounded-md text-ink-muted hover:bg-surface-overlay hover:text-ink';

const wayIn =
  'flex min-h-10 items-center rounded-md bg-accent px-4 text-sm font-bold whitespace-nowrap text-accent-ink no-underline hover:bg-accent-strong hover:no-underline';

/** A member's notifications and account; anyone else's way in. */
function Account({ account }: { readonly account: ShellAccount }) {
  if (account.state === 'member')
    return (
      <>
        <Link href="/notifications" aria-label="Notifications" className={bell}>
          <Icon name="bell" size={20} />
        </Link>
        <Link
          href="/settings"
          aria-label={`Account settings for ${account.username}`}
          className="flex min-w-0 items-center gap-3 rounded-round py-1 pr-4 pl-1 text-ink no-underline hover:bg-surface-overlay hover:no-underline max-compact:pr-1"
        >
          <Avatar name={account.username} presence={viewerStatus} size="md" />
          <span className="flex min-w-0 flex-col max-compact:hidden">
            <span className="truncate text-sm font-bold">
              {account.username}
            </span>
            <span className="text-xs text-ink-muted">
              {statusLabel[viewerStatus]}
            </span>
          </span>
        </Link>
      </>
    );
  const [href, label] =
    account.state === 'anonymous'
      ? ['/sign-in', 'Sign in']
      : ['/onboarding/username', 'Finish sign-up'];
  return (
    <Link href={href} className={wayIn}>
      {label}
    </Link>
  );
}

/**
 * The bar across the top of every shell page: the brand on the left, the
 * account on the right. It never collapses; only the columns under it do.
 */
export function Topbar({ account }: { readonly account: ShellAccount }) {
  return (
    <header
      id="topbar"
      className="sticky top-0 z-40 flex h-topbar items-center justify-between gap-4 bg-surface pr-4 pl-4 area-topbar max-compact:pr-2"
    >
      <Link
        href="/"
        aria-label="Daisy Debate home"
        className="flex shrink-0 items-center gap-2 text-ink no-underline hover:no-underline"
      >
        <DaisyLogo />
        <span className="font-display text-xl leading-shell-brand font-semibold tracking-tight whitespace-nowrap text-ink">
          Daisy Debate
        </span>
      </Link>
      <div className="flex min-w-0 items-center gap-2">
        <Account account={account} />
      </div>
    </header>
  );
}
