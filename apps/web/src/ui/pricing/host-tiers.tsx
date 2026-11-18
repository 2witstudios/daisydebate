import type { PlanPrices } from '../../features/pricing/plan-prices';
import { entryLimitText, formatUsd } from '../../features/pricing/price-text';

/** Host's three ways to run one event: free, then two one-off upgrades. */
export function HostTiers({ host }: { readonly host: PlanPrices['host'] }) {
  const rows = [
    {
      name: 'Free',
      detail: `Up to ${host.freeEntryLimit} entries. No recording, AI judging or broadcast.`,
      price: formatUsd(0),
    },
    ...host.eventUpgrades.map((upgrade) => ({
      name: entryLimitText(upgrade.entryLimit),
      detail: 'One payment for one event.',
      price: formatUsd(upgrade.cents),
    })),
  ];
  return (
    // role="list": WebKit drops list semantics from a markerless <ul>.
    <ul role="list" className="flex list-none flex-col">
      {rows.map((row) => (
        <li
          key={row.name}
          className="flex items-baseline justify-between gap-3 border-t border-border py-2"
        >
          <div className="min-w-0">
            <strong className="block font-strong">{row.name}</strong>
            <span className="block text-sm text-ink-muted">{row.detail}</span>
          </div>
          <strong className="font-display text-lg font-bold whitespace-nowrap">
            {row.price}
          </strong>
        </li>
      ))}
    </ul>
  );
}
