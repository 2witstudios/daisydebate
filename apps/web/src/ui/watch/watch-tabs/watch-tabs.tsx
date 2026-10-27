import type { HubCounts } from '../../../features/watch/hub-counts';
import { hubHref, defaultLiveQuery } from '../../../features/watch/live-query';
import { watchRoutes } from '../../../features/watch/routes';
import { TabLinks } from '../../components/tab-links/tab-links';

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
    },
  ] as const;
  return (
    <TabLinks
      label="Watch sections"
      tabs={tabs.map((tab) => ({ ...tab, selected: active === tab.id }))}
      className="border-b border-border"
    />
  );
}
