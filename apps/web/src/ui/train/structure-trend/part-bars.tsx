import type { StructurePart } from '../../../features/train/summary';
import { Badge } from '../../components/badge/badge';
import { TrainCard } from '../card/train-card';
import { Meter } from '../meter/meter';

export type PartBarsProps = {
  readonly parts: Readonly<Record<StructurePart, number>>;
};

const labels: Readonly<Record<StructurePart, string>> = {
  claim: 'Claim',
  warrant: 'Warrant',
  responding: 'Responding',
  impact: 'Impact',
};

/** Completeness of each part on the first check, weakest flagged. */
export function PartBars({ parts }: PartBarsProps) {
  const entries = (Object.keys(labels) as StructurePart[]).map(
    (part) => [part, parts[part]] as const,
  );
  const weakest = entries.reduce((low, entry) =>
    entry[1] < low[1] ? entry : low,
  )[0];
  return (
    <TrainCard title="Strongest and weakest parts" level={3} sample>
      <p className="text-sm text-ink-muted">
        Complete on the first check, last 30 days.
      </p>
      <ul className="flex flex-col gap-4">
        {entries.map(([part, value]) => (
          <li key={part} className="flex flex-col gap-2">
            <div className="flex items-center justify-between text-base">
              <span className="flex items-center gap-2 font-strong text-ink">
                {labels[part]}
                {part === weakest ? <Badge tone="gold">Weakest</Badge> : null}
              </span>
              <span className="text-ink-muted tabular-nums">{`${value}%`}</span>
            </div>
            <Meter
              value={value}
              label={labels[part]}
              tone={part === weakest ? 'gold' : 'accent'}
            />
          </li>
        ))}
      </ul>
    </TrainCard>
  );
}
