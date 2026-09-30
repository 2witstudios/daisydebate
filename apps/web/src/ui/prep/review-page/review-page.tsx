import Link from 'next/link';
import type { ReviewView } from '../../../features/prep/brief-review';
import { wordCount } from '../../../features/prep/reading-time';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { ItemTile } from '../item-tile/item-tile';
import { PrepIcon } from '../prep-icon/prep-icon';
import { CommentsRail } from './comments-rail';
import { ShareDialog } from './share-dialog';

const link = 'no-underline hover:no-underline';

/** A brief as a reader sees it: its first contention, evidence, and comments. */
export function ReviewPage({ view }: { readonly view: ReviewView }) {
  const { brief, contention } = view;
  return (
    <div className="mx-auto flex w-full max-w-dash-column gap-8 px-6 pt-5 pb-8 max-rail:flex-col max-compact:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Breadcrumb
          crumbs={[
            { label: 'Prep', href: '/prep' },
            { label: 'Briefs', href: '/prep?view=briefs' },
            { label: brief.title },
          ]}
        />
        <header className="flex flex-wrap items-center gap-3">
          <h1 className="min-w-0 flex-1 font-display text-2xl leading-tight font-bold tracking-tight">
            {brief.title}
          </h1>
          <Link
            href={view.share === null ? view.shareHref : view.share.closeHref}
            aria-expanded={view.share !== null}
            className={`${buttonClass('secondary')} ${link}`}
          >
            <PrepIcon name="share" size={18} />
            Share
          </Link>
          <Link
            href={view.editHref}
            className={`${buttonClass('primary')} ${link}`}
          >
            <PrepIcon name="pencil" size={18} />
            Edit
          </Link>
        </header>
        <p className="flex flex-wrap items-center gap-3 text-sm text-ink-muted">
          <Badge tone="accent">{view.sharedLine}</Badge>
          You are the owner.
          {view.threads.length > 0 ? ' Others can comment.' : ''}
        </p>
        {contention === null ? null : (
          <section
            aria-label="Contention 1"
            className="flex flex-col gap-3 rounded-lg bg-surface p-6 shadow-1"
          >
            <div className="flex items-baseline justify-between">
              <h2 className="text-md font-bold">Contention 1</h2>
              <span className="text-sm text-ink-faint">
                {`${wordCount(contention.claim) + wordCount(contention.warrant) + wordCount(contention.impact)} words`}
              </span>
            </div>
            <h3 className="text-base font-strong">{contention.tag}</h3>
            <p className="text-base leading-normal text-ink-muted">
              {contention.claim}{' '}
              {view.openComments > 0 ? (
                <mark className="rounded-sm bg-gold-soft text-ink underline">
                  {contention.warrant}
                </mark>
              ) : (
                contention.warrant
              )}{' '}
              {contention.impact}
            </p>
            {view.openComments > 0 ? (
              <p className="inline-flex items-center gap-2 self-start rounded-round bg-surface-overlay px-3 py-1 text-sm font-strong">
                <PrepIcon name="comment" size={14} />
                {`${view.openComments} open ${view.openComments === 1 ? 'comment' : 'comments'} on this text`}
              </p>
            ) : null}
          </section>
        )}
        <section
          aria-label="Evidence"
          className="flex flex-col gap-2 rounded-lg bg-surface p-6 shadow-1"
        >
          <h2 className="text-base font-strong">
            {`Evidence attached, ${view.evidence.length} ${view.evidence.length === 1 ? 'card' : 'cards'}`}
          </h2>
          <ul>
            {view.evidence.map((card) => (
              <li
                key={card.cardId}
                className="border-t border-border first:border-t-0"
              >
                <Link
                  href={`/prep/cards/${card.cardId}`}
                  className={`flex min-h-12 items-center gap-3 text-ink ${link}`}
                >
                  <ItemTile kind="card" />
                  {card.title}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      </div>
      <CommentsRail view={view} />
      {view.share === null ? null : <ShareDialog share={view.share} />}
    </div>
  );
}
