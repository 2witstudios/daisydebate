import type { ReactNode } from 'react';
import { Sidebar } from './components/sidebar/sidebar';
import { Topbar } from './components/topbar/topbar';
import { RightRail } from './components/right-rail/right-rail';
import { ThemeEffect } from '../../theme-effect';
import styles from './app-shell.module.css';

export type AppShellProps = {
  /** Main content column. */
  readonly children: ReactNode;
  /** Right rail content; hidden on narrow viewports. */
  readonly rail: ReactNode;
};

/**
 * Full-viewport chrome: fixed sidebar, topbar over the content column, and a
 * right rail. Owns interior layout only; content owns its own appearance.
 * The root layout owns the page's single <main> landmark; this column is a
 * plain region of it.
 */
export function AppShell({ children, rail }: AppShellProps) {
  return (
    <div className={styles.shell}>
      <ThemeEffect />
      <div className={styles.sidebar}>
        <Sidebar />
      </div>
      <div className={styles.topbar}>
        <Topbar />
      </div>
      <div className={styles.main}>{children}</div>
      <aside className={styles.rail} aria-label="Sidebar">
        <RightRail>{rail}</RightRail>
      </aside>
    </div>
  );
}
