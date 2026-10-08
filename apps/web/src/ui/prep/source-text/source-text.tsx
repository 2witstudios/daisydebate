import type { Segment } from '../../../features/prep/cards/card';

/**
 * Source text with its layers: read-aloud passages marked, kept passages
 * underlined, the rest plain context. The words are never edited.
 */
export function SourceText({
  segments,
}: {
  readonly segments: readonly Segment[];
}) {
  return (
    <>
      {segments.map((segment, index) =>
        segment.kind === 'read' ? (
          <mark key={index} className="rounded-sm bg-gold-soft text-ink">
            {segment.text}
          </mark>
        ) : segment.kind === 'keep' ? (
          <u key={index} className="underline-offset-2">
            {segment.text}
          </u>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

/** The legend under a full-source view. */
export function SourceLegend() {
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-ink-muted">
      <span>
        <mark className="rounded-sm bg-gold-soft px-1 text-ink">
          Read aloud
        </mark>
      </span>
      <span>
        <u className="underline-offset-2">Kept, not read</u>
      </span>
      <span>Plain text is context</span>
    </p>
  );
}
