import type { DetailRow } from '../../../features/watch/replay-panels';

export type DetailsPanelProps = {
  readonly rows: readonly DetailRow[];
};

/** The facts about the recording, as label and value rows. */
export function DetailsPanel({ rows }: DetailsPanelProps) {
  return (
    <section
      aria-label="Details"
      className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4 shadow-1"
    >
      <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Details
      </span>
      <dl className="flex flex-col gap-1 text-base">
        {rows.map((row) => (
          <div key={row.label} className="flex justify-between gap-3">
            <dt className="text-ink-muted">{row.label}</dt>
            <dd className="text-ink">{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}
