import { sideTextClass } from '../ballot/ballot-class';
import { cn } from '../cn';
import type { TranscriptSection } from './result-view';

const labels = {
  capturing: 'Capturing',
  partial: 'Partial',
  complete: 'Complete',
  pending: 'Waiting for transcript',
} as const;
/** Shared native transcript markup for live and completed authorized audiences. */
export function TranscriptContent({
  sections,
  empty,
}: {
  readonly sections: readonly TranscriptSection[];
  readonly empty: string;
}) {
  return sections.length ? (
    <details>
      <summary className="min-h-room-target cursor-pointer font-strong">
        Show the transcript
      </summary>
      {sections.map((section) => (
        <section key={section.key} className="pt-3">
          <h3
            className={cn(
              'mb-1 text-sm font-strong',
              sideTextClass(section.side),
            )}
          >
            {section.heading}
          </h3>
          {section.status ? (
            <p className="text-xs text-ink-muted">{labels[section.status]}</p>
          ) : null}
          <ol className="flex flex-col gap-1">
            {section.lines.map((line) => (
              <li key={line.id} className="text-sm wrap-anywhere text-ink">
                <span className="font-strong">{line.speaker}: </span>
                {line.text}
                {line.partial ? (
                  <span className="text-ink-muted"> (cut off)</span>
                ) : null}
              </li>
            ))}
          </ol>
        </section>
      ))}
    </details>
  ) : (
    <p className="text-ink-muted">{empty}</p>
  );
}
