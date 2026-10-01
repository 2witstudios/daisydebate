import type { Fact } from '../../../features/tournaments/facts';

/** Label and value rows, label left, value right. */
export function FactList({ facts }: { readonly facts: readonly Fact[] }) {
  return (
    <dl className="flex flex-col">
      {facts.map(([label, value]) => (
        <div
          key={label}
          className="flex justify-between gap-6 border-t border-border py-2 first:border-t-0"
        >
          <dt className="text-base text-ink-muted">{label}</dt>
          <dd className="text-right text-base text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
