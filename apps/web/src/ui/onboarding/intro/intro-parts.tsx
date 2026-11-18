import { cn } from '../../cn';

/** A numbered list of [title, detail] rows, the marker in the slide's colour. */
export function NumberedSteps({
  steps,
  markerClass,
}: {
  readonly steps: ReadonlyArray<readonly [string, string]>;
  /** The marker's fill and ink, e.g. `bg-accent text-accent-ink`. */
  readonly markerClass: string;
}) {
  return (
    <ol className="flex flex-col gap-4">
      {steps.map(([title, detail], index) => (
        <li key={title} className="flex gap-3">
          <span
            className={cn(
              'flex size-8 shrink-0 items-center justify-center rounded-round text-sm font-strong',
              markerClass,
            )}
          >
            {index + 1}
          </span>
          <div className="flex min-w-0 flex-col gap-1">
            <span className="text-md font-strong text-ink">{title}</span>
            <span className="text-base leading-normal text-ink-muted">
              {detail}
            </span>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** One way to use Daisy, or one tool: a titled card with a summary and points. */
export function IntroCard({
  name,
  tag,
  summary,
  points,
}: {
  readonly name: string;
  readonly tag?: { readonly label: string; readonly className: string };
  readonly summary: string;
  readonly points: readonly string[];
}) {
  return (
    <li className="flex min-w-0 flex-col gap-2 rounded-lg border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-xl font-semibold text-ink">{name}</h2>
        {tag ? <span className={tag.className}>{tag.label}</span> : null}
      </div>
      <p className="text-sm leading-normal text-ink-muted">{summary}</p>
      <ul className="flex list-disc flex-col gap-1 pl-5 text-sm leading-normal text-ink">
        {points.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ul>
    </li>
  );
}
