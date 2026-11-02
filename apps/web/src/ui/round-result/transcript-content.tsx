import { sideTextClass } from '../ballot/ballot-class';
import { cn } from '../cn';
import { formatOffset } from '../../features/debate-room/transcript';
import { sectionItems, type TranscriptSection } from './result-view';

/** One wording for a transcript's capture state, live and completed. */
export const transcriptStatusLabels = {
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
            <p className="text-xs text-ink-muted">
              {transcriptStatusLabels[section.status]}
            </p>
          ) : null}
          <ol className="flex flex-col gap-1">
            {sectionItems(section).map((item) =>
              item.kind === 'gap' ? (
                <li key={item.key} className="text-sm text-ink-muted">
                  {item.speaker}: not captured {formatOffset(item.fromOffsetMs)}
                  –{formatOffset(item.untilOffsetMs)}
                </li>
              ) : (
                <li key={item.id} className="text-sm wrap-anywhere text-ink">
                  <span className="font-strong">{item.speaker}: </span>
                  {item.text}
                  {item.partial ? (
                    <span className="text-ink-muted"> (cut off)</span>
                  ) : null}
                </li>
              ),
            )}
          </ol>
        </section>
      ))}
    </details>
  ) : (
    <p className="text-ink-muted">{empty}</p>
  );
}
