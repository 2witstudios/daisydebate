import type { ReactNode } from 'react';
import type { ShellAccount } from './account';
import { Rail } from './components/rail/rail';
import { TabBar } from './components/tab-bar/tab-bar';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** Who is signed in: a member gets their own places, a visitor a way in. */
  readonly account: ShellAccount;
};

/**
 * Full-viewport chrome: one navigation rail beside the page, which never
 * collapses, or on a phone a tab bar along the bottom. Owns interior layout
 * only; content owns its own appearance. This component owns the page's
 * single <main> landmark: the root layout renders no landmark of its own.
 * Both navigations are in the markup and the layout shows one, so the shell
 * is right before any script runs.
 */
export function AppShell({ children, account }: AppShellProps) {
  return (
    <div className="grid min-h-screen grid-shell items-start bg-background">
      <Rail account={account} />
      <main className="min-w-0 area-main">{children}</main>
      <TabBar account={account} />
    </div>
  );
}
