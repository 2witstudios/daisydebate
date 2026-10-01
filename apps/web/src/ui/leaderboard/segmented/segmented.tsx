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
};

/**
 * A row of links where one is current. Links, not buttons, so the choice
 * works before hydration and lives in the URL.
 */
export function Segmented({ label, segments }: SegmentedProps) {
  return (
    <nav
      aria-label={label}
      className="inline-flex gap-1 rounded-md bg-surface-overlay p-1"
    >
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
