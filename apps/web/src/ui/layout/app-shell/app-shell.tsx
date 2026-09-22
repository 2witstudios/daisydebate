import type { ReactNode } from 'react';
import { Sidebar } from './components/sidebar/sidebar';
import { Topbar, type ShellAccount } from './components/topbar/topbar';
import { RightRail } from './components/right-rail/right-rail';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** Right rail content; hidden on narrow viewports. */
  readonly rail: ReactNode;
  /** The visitor's account control in the topbar. */
  readonly account: ShellAccount;
};

/**
 * Full-viewport chrome: fixed sidebar, topbar over the content column, and a
 * right rail. Owns interior layout only; content owns its own appearance.
 * The root layout owns the page's single <main> landmark; this column is a
 * plain region of it.
 */
export function AppShell({ children, rail, account }: AppShellProps) {
  return (
    <div className="grid min-h-screen grid-shell items-start max-rail:grid-shell-reflow max-compact:grid-shell-icons">
      <div className="sticky top-0 z-20 h-screen border-r border-border bg-surface area-sidebar">
        <Sidebar />
      </div>
      <div className="sticky top-0 z-10 border-b border-border bg-surface area-topbar">
        <Topbar account={account} />
      </div>
      <div className="min-w-0 area-main">{children}</div>
      <aside
        className="sticky top-topbar h-rail-viewport min-w-0 border-l border-border bg-surface area-rail max-rail:static max-rail:h-auto max-rail:border-t max-rail:border-l-0"
        aria-label="Sidebar"
      >
        <RightRail>{rail}</RightRail>
      </aside>
    </div>
  );
}
