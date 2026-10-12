import Link from 'next/link';
import type { ListedRow } from '../../../features/prep/library/list-library';
import { kindLabel } from '../item-tile/item-tile';
import { itemKindClass } from '../item-tile/item-tile-class';
import { VisibilityMark } from '../visibility-mark/visibility-mark';

const rowLink =
  'flex min-h-16 flex-col gap-1 px-4 py-3 text-ink no-underline hover:bg-surface-overlay hover:no-underline';

function RowBody({ row }: { readonly row: ListedRow }) {
  return (
    <>
      <span className="flex items-center justify-between gap-3">
        <span className={itemKindClass(row.kind)}>{kindLabel[row.kind]}</span>
        <span className="flex items-center gap-2 text-xs text-ink-faint">
          {row.visibility.kind === 'team' ? (
            <VisibilityMark visibility={row.visibility} />
          ) : null}
          {row.meta}
        </span>
      </span>
      <span className="text-base font-strong">{row.title}</span>
      <span className="text-sm text-ink-muted">{row.subtitle}</span>
    </>
  );
}

/**
 * One library item. On a wide screen the row opens the item in the preview
 * pane; on a phone, where there is no pane, it opens the item itself. Both
 * are plain links, so the list works with no script.
 */
function LibraryRowItem({ row }: { readonly row: ListedRow }) {
  return (
    <li className="border-t border-border first:border-t-0">
      <Link
        href={row.previewHref}
        aria-current={row.selected ? 'true' : undefined}
        scroll={false}
        className={`${rowLink} max-compact:hidden ${row.selected ? 'bg-surface-overlay' : ''}`}
      >
        <RowBody row={row} />
      </Link>
      <Link href={row.href} className={`${rowLink} hidden max-compact:flex`}>
        <RowBody row={row} />
      </Link>
    </li>
  );
}

/** The rows of a list; the column around them belongs to the page. */
export function LibraryList(props: {
  readonly label: string;
  readonly rows: readonly ListedRow[];
}) {
  return (
    <ul aria-label={props.label}>
      {props.rows.map((row) => (
        <LibraryRowItem key={row.id} row={row} />
      ))}
    </ul>
  );
}
