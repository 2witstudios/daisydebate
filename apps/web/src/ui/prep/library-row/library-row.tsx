import Link from 'next/link';
import type { LibraryRow as Row } from '../../../features/prep/library-row';
import { ItemTile, kindLabel } from '../item-tile/item-tile';
import { TagList } from '../tag-list/tag-list';
import { VisibilityMark } from '../visibility-mark/visibility-mark';

/**
 * One library item: the whole row is the link. On desktop tags and
 * visibility take their own columns; on the phone they sit under the title.
 */
function LibraryRowItem({ row }: { readonly row: Row }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link
        href={row.href}
        className="flex min-h-16 items-start gap-4 px-5 py-3 text-ink no-underline hover:bg-surface-overlay hover:no-underline max-compact:px-4"
      >
        <ItemTile kind={row.kind} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">{`${kindLabel[row.kind]}: `}</span>
          <span className="text-base font-strong">{row.title}</span>
          <span className="text-sm text-ink-muted">{row.subtitle}</span>
          <span className="hidden flex-wrap items-center gap-x-3 gap-y-1 max-compact:flex">
            <TagList tags={row.tags} />
            <VisibilityMark visibility={row.visibility} />
          </span>
        </span>
        <span className="basis-1/4 max-compact:hidden">
          <TagList tags={row.tags} />
        </span>
        <span className="flex basis-1/6 flex-col items-end gap-1 text-right max-compact:hidden">
          <VisibilityMark visibility={row.visibility} />
          <span className="text-xs text-ink-faint">{row.meta}</span>
        </span>
      </Link>
    </li>
  );
}

/** The rounded card a list of rows sits in. */
export function LibraryList(props: {
  readonly label: string;
  readonly rows: readonly Row[];
}) {
  return (
    <ul
      aria-label={props.label}
      className="overflow-hidden rounded-lg border border-border bg-surface-raised shadow-1"
    >
      {props.rows.map((row) => (
        <LibraryRowItem key={row.id} row={row} />
      ))}
    </ul>
  );
}
