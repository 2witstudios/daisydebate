import type { ReactNode } from 'react';
import type { ShellAccount } from './account';
import { Sidebar } from './components/sidebar/sidebar';
import { SocialRail } from './components/social-rail/social-rail';
import { ShellGrid } from './components/dock/shell-grid';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** Who is signed in: a member gets the social rail, a visitor a way in. */
  readonly account: ShellAccount;
};

/**
 * Full-viewport chrome in three columns: navigation on the left, the page,
 * and the social rail (you and your friends) on the right. Both side columns
 * run the full height and carry their own collapse control. Owns interior
 * layout only; content owns its own appearance. This component owns the
 * page's single <main> landmark: the root layout renders no landmark of its
 * own, so nav, main and aside are siblings here, not nested inside one
 * another.
 */
export function AppShell({ children, account }: AppShellProps) {
  return (
    <ShellGrid hasDock={account.state === 'member'}>
      {/* The column runs the page's full height; only its content is pinned. */}
      <div className="z-20 self-stretch border-r border-border bg-surface area-sidebar">
        <div className="relative tall:sticky tall:top-0 tall:h-screen">
          <Sidebar account={account} />
        </div>
      </div>
      <main className="min-w-0 area-main">{children}</main>
      <SocialRail account={account} />
    </ShellGrid>
  );
}
