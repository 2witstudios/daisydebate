import Link from 'next/link';
import { inertActions, prepDestinations } from '../../../features/prep/actions';
import type { LibraryPreview as Preview } from '../../../features/prep/library/library-row';
import { buttonClass } from '../../components/button/button-class';
import { kindLabel } from '../item-tile/item-tile';
import { itemBadgeClass } from '../item-tile/item-tile-class';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import { TagList } from '../tag-list/tag-list';

const action = 'min-h-prep-control px-3 py-2 text-sm';
const link = 'no-underline hover:no-underline';

/** Who can read the item: private links to the privacy page. */
function Access({ preview }: { readonly preview: Preview }) {
  if (preview.visibility.kind === 'team')
    return (
      <span className="text-xs text-ink-muted">{`Shared with ${preview.visibility.teamName}`}</span>
    );
  return (
    <Link
      href={prepDestinations.privacy}
      className="inline-flex items-center gap-1 text-xs text-ink-muted"
    >
      <PrepIcon name="lock" size={14} />
      Private to you
    </Link>
  );
}

/**
 * The library item open beside the list: its kind and access, share, add
 * and open, then the claim, cite, a card's passage, tags and where it is
 * used. Wide screens only; a phone opens the item itself.
 */
export function LibraryPreview({ preview }: { readonly preview: Preview }) {
  return (
    <article
      aria-label="Preview"
      className="flex min-w-0 flex-1 flex-col gap-5 bg-surface-raised px-10 py-8 max-compact:hidden"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className={itemBadgeClass(preview.kind)}>
          {kindLabel[preview.kind]}
        </span>
        <Access preview={preview} />
        <span className="flex-1" />
        {preview.kind === 'brief' ? (
          <Link
            href={`${preview.href}/review?share=open`}
            className={`${buttonClass('secondary')} ${action} ${link}`}
          >
            Share
          </Link>
        ) : (
          <InertActionButton action={inertActions.share} className={action} />
        )}
        {preview.kind === 'card' ? (
          <InertActionButton
            action={inertActions.addToBrief}
            className={action}
          />
        ) : null}
        <Link
          href={preview.href}
          className={`${buttonClass('primary')} ${action} ${link}`}
        >
          Open
        </Link>
      </div>
      <h2 className="font-display text-2xl leading-tight font-bold tracking-tight">
        {preview.title}
      </h2>
      <p className="text-sm text-ink-muted">{preview.subtitle}</p>
      {preview.passage === undefined ? null : (
        <blockquote className="rounded-lg border border-border bg-surface p-5 font-display text-md leading-normal text-ink-muted">
          {preview.passage}
        </blockquote>
      )}
      <TagList tags={preview.tags} />
      <p className="mt-auto border-t border-border pt-4 text-sm text-ink-faint">
        {preview.usage}
      </p>
    </article>
  );
}
