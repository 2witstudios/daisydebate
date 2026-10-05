import type { ReactNode } from 'react';
import { Sidebar } from './components/sidebar/sidebar';
import { Topbar, type ShellAccount } from './components/topbar/topbar';
import { ChatDock } from './components/chat-dock/chat-dock';
import { ShellGrid } from './components/dock/shell-grid';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** The visitor's account control in the topbar. */
  readonly account: ShellAccount;
};

/**
 * Full-viewport chrome: fixed sidebar, topbar over the content column, and
 * the friends dock on the right.
 * Owns interior layout only; content owns its own appearance. This component
 * owns the page's single <main> landmark: the root layout renders no landmark
 * of its own, so header, nav, main and aside are siblings here, not nested
 * inside one another.
 */
export function AppShell({ children, account }: AppShellProps) {
  return (
    <ShellGrid hasDock={account.state === 'member'}>
      <div className="sticky top-0 z-20 h-screen border-r border-border bg-surface area-sidebar">
        <Sidebar account={account} />
      </div>
      <div className="sticky top-0 z-10 border-b border-border bg-surface area-topbar">
        <Topbar account={account} />
      </div>
      <main className="min-w-0 area-main">{children}</main>
      <ChatDock account={account} />
    </ShellGrid>
  );
}
