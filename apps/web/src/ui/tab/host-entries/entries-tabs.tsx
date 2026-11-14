import type { EntriesTabs as Counts } from '../../../features/tab/entries';
import { TabLinks } from '../../components/tab-links/tab-links';

/** Debaters and judges are two tabs of one Entries page. */
export function EntriesTabs({
  counts,
  selected,
  entriesHref,
  judgesHref,
}: {
  readonly counts: Counts;
  readonly selected: 'debaters' | 'judges';
  readonly entriesHref: string;
  readonly judgesHref: string;
}) {
  return (
    <TabLinks
      label="Entries or judges"
      tabs={[
        {
          id: 'debaters',
          label: 'Debaters',
          href: entriesHref,
          selected: selected === 'debaters',
          count: counts.debaters,
        },
        {
          id: 'judges',
          label: 'Judges',
          href: judgesHref,
          selected: selected === 'judges',
          count: counts.judges,
        },
      ]}
    />
  );
}
