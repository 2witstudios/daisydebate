import Link from 'next/link';
import { paneTabClass } from '../spectate/spectate-class';

export type PaneTabsProps = {
  readonly panes: readonly {
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly active: boolean;
  }[];
};

/** Phone-only pane tabs: links that set `?pane=`, so they work with no script. */
export function PaneTabs({ panes }: PaneTabsProps) {
  return (
    <nav
      aria-label="Pane"
      className="hidden border-b border-border max-compact:flex"
    >
      {panes.map((pane) => (
        <Link
          key={pane.id}
          href={pane.href}
          aria-current={pane.active ? 'page' : undefined}
          className={paneTabClass(pane.active)}
        >
          {pane.label}
        </Link>
      ))}
    </nav>
  );
}
