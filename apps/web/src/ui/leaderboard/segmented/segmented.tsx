import Link from 'next/link';
import { segmentClass } from './segmented-class';

type Segment = {
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
};

export type SegmentedProps = {
  readonly label: string;
  readonly segments: readonly Segment[];
  /** Show the label as a caption before the segments, as the ladder filters do. */
  readonly captioned?: boolean;
};

/**
 * A row of links where one is current. Links, not buttons, so the choice
 * works before hydration and lives in the URL.
 */
export function Segmented({
  label,
  segments,
  captioned = false,
}: SegmentedProps) {
  return (
    <nav
      aria-label={label}
      className="inline-flex items-center gap-1 rounded-md bg-surface-overlay p-1"
    >
      {captioned ? (
        <span
          aria-hidden="true"
          className="px-2 text-xs font-strong text-ink-muted"
        >
          {label}
        </span>
      ) : null}
      {segments.map((segment) => (
        <Link
          key={segment.label}
          href={segment.href}
          aria-current={segment.selected ? 'page' : undefined}
          className={segmentClass(segment.selected)}
        >
          {segment.label}
        </Link>
      ))}
    </nav>
  );
}
