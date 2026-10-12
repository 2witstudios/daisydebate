import Link from 'next/link';
import { cn } from '../../cn';
import { paneTabClass } from '../spectate/spectate-class';

export type PaneTabsProps = {
  readonly panes: readonly {
    readonly id: string;
    readonly label: string;
    readonly href: string;
    readonly active: boolean;
  }[];
  /** The navigation's accessible name. */
  readonly label?: string;
  /** False keeps the tabs at every width. */
  readonly phoneOnly?: boolean;
};

/** Pane tabs: links that set `?pane=`, so they work with no script. */
export function PaneTabs({
  panes,
  label = 'Pane',
  phoneOnly = true,
}: PaneTabsProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'border-b border-border',
        phoneOnly ? 'hidden max-compact:flex' : 'flex',
      )}
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
