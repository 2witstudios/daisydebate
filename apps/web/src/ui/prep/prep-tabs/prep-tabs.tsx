import { TabLinks } from '../../components/tab-links/tab-links';

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

/** Prep's tab row: the shared link tabs, with the current id selected. */
export function PrepTabs({ label, tabs, current }: PrepTabsProps) {
  return (
    <TabLinks
      label={label}
      tabs={tabs.map((tab) => ({ ...tab, selected: tab.id === current }))}
      className="border-b border-border"
    />
  );
}
