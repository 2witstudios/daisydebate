import Link from 'next/link';
import { prepTabClass } from './prep-tabs-class';

type PrepTab = {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Shown faint after the label when present. */
  readonly count?: number;
};

export type PrepTabsProps = {
  readonly label: string;
  readonly tabs: readonly PrepTab[];
  readonly current: string;
};

/** Tabs are links, so they work before hydration and keep the URL honest. */
export function PrepTabs({ label, tabs, current }: PrepTabsProps) {
  return (
    <nav aria-label={label} className="overflow-x-auto border-b border-border">
      <ul className="flex gap-1">
        {tabs.map((tab) => (
          <li key={tab.id}>
            <Link
              href={tab.href}
              className={prepTabClass(tab.id === current)}
              aria-current={tab.id === current ? 'page' : undefined}
            >
              {tab.label}
              {tab.count === undefined ? null : (
                <span className="font-book text-ink-faint">{tab.count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
