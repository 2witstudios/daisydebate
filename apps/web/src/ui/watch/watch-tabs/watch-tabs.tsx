import Link from 'next/link';
import type { HubCounts } from '../../../features/watch/hub-counts';
import { hubHref, defaultLiveQuery } from '../../../features/watch/live-query';
import { watchRoutes } from '../../../features/watch/routes';
import { watchTabClass } from './watch-tabs-class';

export type WatchSection = 'live' | 'recordings' | 'following';

export type WatchTabsProps = {
  readonly active: WatchSection;
  readonly counts: HubCounts;
};

/**
 * The hub's sections are links, so they work before hydration. Live and
 * Following are public hub views; Recordings is the guarded archive route.
 */
export function WatchTabs({ active, counts }: WatchTabsProps) {
  const tabs = [
    { id: 'live', label: 'Live', href: watchRoutes.hub, count: counts.live },
    {
      id: 'recordings',
      label: 'Recordings',
      href: watchRoutes.recordings,
      count: counts.recordings,
    },
    {
      id: 'following',
      label: 'Following',
      href: hubHref({ ...defaultLiveQuery, tab: 'following' }),
      count: null,
    },
  ] as const;
  return (
    <nav aria-label="Watch sections" className="border-b border-border">
      <ul className="flex gap-1">
        {tabs.map(({ id, label, href, count }) => (
          <li key={id}>
            <Link
              href={href}
              className={watchTabClass(active === id)}
              aria-current={active === id ? 'page' : undefined}
            >
              {label}
              {count === null ? null : (
                <span className="font-book text-ink-faint">{count}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
