import type { ReactNode } from 'react';
import type { ShellAccount } from './account';
import { Sidebar } from './components/sidebar/sidebar';
import { SocialRail } from './components/social-rail/social-rail';
import { ShellGrid } from './components/dock/shell-grid';
import { Topbar } from './components/topbar/topbar';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** Who is signed in: a member gets their account and friends, a visitor a way in. */
  readonly account: ShellAccount;
};

/**
 * Full-viewport chrome: a bar across the top with the brand and the account,
 * which never collapses, and under it three columns: navigation on the left,
 * the page, and a member's friends on the right. Each side column collapses
 * with its own tab. Owns interior layout only; content owns its own
 * appearance. This component owns the page's single <main> landmark: the
 * root layout renders no landmark of its own, so header, nav, main and aside
 * are siblings here, not nested inside one another.
 */
export function AppShell({ children, account }: AppShellProps) {
  return (
    <ShellGrid hasDock={account.state === 'member'}>
      <Topbar account={account} />
      {/* The column runs the page's full height; only its content is pinned. */}
      <div className="z-20 self-stretch bg-surface area-sidebar">
        <div className="tall:sticky tall:top-topbar tall:h-below-topbar">
          <Sidebar account={account} />
        </div>
      </div>
      {/* The page is one sheet set into the frame of bar and columns. */}
      <main
        className={`min-w-0 rounded-t-xl border border-b-0 border-border bg-background area-main ${account.state === 'member' ? '' : 'mr-3'}`}
      >
        {children}
      </main>
      <SocialRail account={account} />
    </ShellGrid>
  );
}
