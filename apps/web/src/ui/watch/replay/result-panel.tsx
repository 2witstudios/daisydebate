import type { ResultPanel as Model } from '../../../features/watch/replay-panels';
import { cn } from '../../cn';

export type ResultPanelProps = {
  readonly result: Model;
};

const card =
  'flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 shadow-1';

/** The decision and rating changes, or how many ballots are in so far. */
export function ResultPanel({ result }: ResultPanelProps) {
  if (result.kind === 'pending')
    return (
      <section aria-label="Result" className={card}>
        <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
          Result
        </span>
        <span className="font-display text-xl font-bold text-ink">
          Result pending
        </span>
        <span className="text-sm text-ink-muted">
          {`${result.received} of ${result.of} ballots are in`}
        </span>
        <div aria-hidden="true" className="flex gap-1">
          {Array.from({ length: result.of }, (_, index) => (
            <span
              key={index}
              className={cn(
                'h-1 flex-1 rounded-round',
                index < result.received ? 'bg-accent' : 'bg-surface-overlay',
              )}
            />
          ))}
        </div>
      </section>
    );
  return (
    <section aria-label="Result" className={card}>
      <span className="text-xs font-bold tracking-widest text-ink-muted uppercase">
        Result
      </span>
      <span className="font-display text-xl font-bold text-ink">
        {result.headline}
      </span>
      {result.lines.length > 0 ? (
        <ul className="flex flex-col gap-1 text-base">
          {result.lines.map((line) => (
            <li
              key={line.who}
              className="flex items-baseline justify-between gap-3"
            >
              <span className="text-ink">{line.who}</span>
              <span className="text-ink-muted tabular-nums">{line.range}</span>
              <span className="font-strong text-ink tabular-nums">
                {line.delta}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      <span className="text-xs text-ink-faint">{result.note}</span>
      <div className="flex flex-col divide-y divide-border rounded-md border border-border">
        {result.judges.map((judge) => (
          <details key={judge.title} className="p-3">
            <summary className="flex cursor-pointer items-center justify-between gap-3 text-base">
              <span className="font-strong text-ink">{judge.title}</span>
              <span className="text-sm text-ink-muted">{judge.summary}</span>
            </summary>
            <p className="pt-2 text-sm text-ink-muted">{judge.reasons}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
