import Link from 'next/link';
import type { LibraryRow as Row } from '../../../features/prep/library-row';
import { ItemTile, kindLabel } from '../item-tile/item-tile';
import { VisibilityMark } from '../visibility-mark/visibility-mark';

/**
 * One library item: the whole row is the link. A title, one line about it,
 * and on the right when it was last touched; a shared item says so, and
 * private is simply the default, so it is not repeated on every row.
 */
function LibraryRowItem({ row }: { readonly row: Row }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link
        href={row.href}
        className="flex min-h-16 items-center gap-4 px-5 py-3 text-ink no-underline hover:bg-surface-overlay hover:no-underline max-compact:px-4"
      >
        <ItemTile kind={row.kind} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="sr-only">{`${kindLabel[row.kind]}: `}</span>
          <span className="text-base font-strong">{row.title}</span>
          <span className="text-sm text-ink-muted">{row.subtitle}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 text-right max-compact:hidden">
          <span className="text-xs text-ink-faint">{row.meta}</span>
          {row.visibility.kind === 'team' ? (
            <VisibilityMark visibility={row.visibility} />
          ) : null}
        </span>
      </Link>
    </li>
  );
}

/** The rows of a list; the card around them belongs to the page. */
export function LibraryList(props: {
  readonly label: string;
  readonly rows: readonly Row[];
}) {
  return (
    <ul aria-label={props.label}>
      {props.rows.map((row) => (
        <LibraryRowItem key={row.id} row={row} />
      ))}
    </ul>
  );
}
