import Link from 'next/link';
import type { TabCounts } from '../../../features/lobby/filter';
import {
  lobbyHref,
  type LobbyQuery,
  type LobbyTab,
} from '../../../features/lobby/query';
import { tabClass } from './lobby-tabs-class';

export type LobbyTabsProps = {
  readonly query: LobbyQuery;
  readonly counts: TabCounts;
  readonly className?: string;
};

const tabs: readonly { id: LobbyTab; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'open', label: 'Open tables' },
  { id: 'live', label: 'Live' },
];

/** Tabs are links, so they work before hydration and keep the other filters. */
export function LobbyTabs({ query, counts, className }: LobbyTabsProps) {
  return (
    <nav aria-label="Room status" className={className}>
      <ul className="flex gap-1">
        {tabs.map(({ id, label }) => (
          <li key={id}>
            <Link
              href={lobbyHref({ ...query, tab: id })}
              className={tabClass(query.tab === id)}
              aria-current={query.tab === id ? 'page' : undefined}
            >
              {label}
              <span className="font-book text-ink-faint">{counts[id]}</span>
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
