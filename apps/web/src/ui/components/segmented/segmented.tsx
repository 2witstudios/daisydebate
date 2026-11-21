import Link from 'next/link';
import { cn } from '../../cn';
import { segmentClass } from './segmented-class';

type Segment = {
  readonly label: string;
  readonly href: string;
  readonly selected: boolean;
};

export type SegmentedProps = {
  /** The group's accessible name; never shown inside the group. */
  readonly label: string;
  readonly segments: readonly Segment[];
  /** Fill the width on a phone, each segment an equal share (the lobby switch). */
  readonly fillOnPhone?: boolean;
  /** Labels entered by hosts can be long and the list can grow. */
  readonly wrap?: boolean;
};

/**
 * A row of links where one is current. Links, not buttons, so the choice
 * works before hydration and lives in the URL.
 */
export function Segmented({
  label,
  segments,
  fillOnPhone = false,
  wrap = false,
}: SegmentedProps) {
  return (
    <nav
      aria-label={label}
      className={cn(
        'inline-flex items-center gap-1 self-start rounded-md bg-surface-overlay p-1',
        fillOnPhone && 'max-narrow:flex max-narrow:self-stretch',
        wrap && 'max-w-full flex-wrap',
      )}
    >
      {segments.map((segment) => (
        <Link
          key={segment.href}
          href={segment.href}
          aria-current={segment.selected ? 'page' : undefined}
          className={cn(
            wrap
              ? segmentClass(segment.selected).replace(
                  'whitespace-nowrap',
                  'max-w-full wrap-anywhere',
                )
              : segmentClass(segment.selected),
            fillOnPhone && 'max-narrow:flex-1 max-narrow:justify-center',
          )}
        >
          {segment.label}
        </Link>
      ))}
    </nav>
  );
}
