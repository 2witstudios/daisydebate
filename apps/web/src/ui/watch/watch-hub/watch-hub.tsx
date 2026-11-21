import type { ReactNode } from 'react';
import type { HubCounts } from '../../../features/watch/hub-counts';
import { WatchTabs, type WatchSection } from '../watch-tabs/watch-tabs';

export type WatchHubProps = {
  readonly active: WatchSection;
  readonly lobby?: string;
  readonly counts: HubCounts;
  readonly children: ReactNode;
};

/** The Watch page frame: title, the three sections, and the active one. */
export function WatchHub({
  active,
  lobby = '',
  counts,
  children,
}: WatchHubProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
        Watch
      </h1>
      <WatchTabs active={active} counts={counts} lobby={lobby} />
      {children}
    </div>
  );
}
