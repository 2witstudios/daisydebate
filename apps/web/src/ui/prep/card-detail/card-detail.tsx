import Link from 'next/link';
import type { CardDetailView } from '../../../features/prep/cards/card-detail';
import { inertActions } from '../../../features/prep/actions';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { Breadcrumb } from '../breadcrumb/breadcrumb';
import { DetailList } from '../detail-list/detail-list';
import { InertActionButton } from '../inert-action/inert-action';
import { PrepIcon } from '../prep-icon/prep-icon';
import { PrepTabs } from '../prep-tabs/prep-tabs';
import { SourceLegend, SourceText } from '../source-text/source-text';
import { TagList } from '../tag-list/tag-list';
import { VisibilityMark } from '../visibility-mark/visibility-mark';

const cardBox = 'flex flex-col gap-3 rounded-lg bg-surface p-6 shadow-1';
const heading = 'text-xs font-bold tracking-widest text-ink-muted uppercase';

function Byline({ view }: { readonly view: CardDetailView }) {
  const { card } = view;
  return (
    <p className="border-b border-border pb-3 text-sm text-ink-muted">
      <strong className="text-ink">{`${card.author} ${card.year}`}</strong>
      {` · ${card.qualifications}, ${card.publication}`}
    </p>
  );
}

function Provenance({ view }: { readonly view: CardDetailView }) {
  const { card } = view;
  return (
    <section aria-labelledby="prov-heading" className={cardBox}>
      <h2 id="prov-heading" className="text-md font-bold">
        Citation and provenance
      </h2>
      <DetailList
        rows={[
          ...view.provenance,
          [
            'URL',
            <a
              key="url"
              href={card.url}
              rel="noreferrer noopener"
              className="inline-flex items-center gap-1"
            >
              {card.url.replace(/^https?:\/\//, '')}
              <PrepIcon name="external" size={14} />
            </a>,
          ],
          [
            'Source copy',
            <span key="copy" className="inline-flex items-center gap-1">
              <PrepIcon name="check" size={14} className="text-online" />
              Saved, unchanged
            </span>,
          ],
          ['Link check', `Reachable on ${card.retrieved}`],
        ]}
      />
    </section>
  );
}

/** One evidence card: read it, see its source, trace its use and history. */
export function CardDetail({ view }: { readonly view: CardDetailView }) {
  const { card, query } = view;
  return (
    <div className="mx-auto flex w-full max-w-dash-column gap-8 px-6 pt-5 pb-8 max-rail:flex-col max-compact:gap-4 max-compact:px-4">
      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Breadcrumb
          crumbs={[
            { label: 'Prep', href: '/prep' },
            { label: 'Evidence cards', href: '/prep?view=cards' },
            { label: card.tagLine },
          ]}
        />
        <header className="flex flex-col gap-2">
          <h1 className="font-display text-2xl leading-tight font-bold tracking-tight">
            {card.tagLine}
          </h1>
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone="accent">Evidence card</Badge>
            <VisibilityMark visibility={card.visibility} />
            <span className="text-sm text-ink-faint">
              {`Version ${view.shown.version} · used in ${card.uses.length} ${card.uses.length === 1 ? 'place' : 'places'}`}
            </span>
          </div>
          <TagList tags={view.shown.tags} />
        </header>
        <div className="flex flex-wrap gap-3">
          <InertActionButton
            action={inertActions.addToBrief}
            variant="primary"
            symbol="plus"
          />
          <InertActionButton action={inertActions.copyCite} symbol="copy" />
          <InertActionButton action={inertActions.share} symbol="share" />
          <InertActionButton action={inertActions.edit} symbol="pencil" />
          <details className="relative">
            <summary
              aria-label="More actions"
              className={`${buttonClass('secondary')} list-none`}
            >
              <PrepIcon name="dots" size={18} />
            </summary>
            <div className="absolute z-10 mt-2 flex min-w-rail flex-col rounded-md border border-border-strong bg-surface-raised p-2 shadow-2">
              <Link
                href={view.deleteHref}
                className="flex min-h-12 items-center gap-2 px-3 text-base text-live no-underline hover:no-underline"
              >
                <PrepIcon name="trash" size={18} />
                Delete card
              </Link>
            </div>
          </details>
        </div>
        {view.pastVersion === null ? null : (
          <p
            role="status"
            className="flex flex-wrap items-center gap-3 rounded-md border border-gold-border bg-gold-soft p-4 text-sm"
          >
            <PrepIcon name="history" size={18} className="text-gold" />
            {`Version ${view.pastVersion.version}`}
            <Link href={view.pastVersion.currentHref}>
              Back to the current version
            </Link>
          </p>
        )}
        <PrepTabs
          label="Card view"
          current={query.view}
          tabs={view.tabs.map((tab) => ({
            id: tab.id,
            label: tab.label,
            href: tab.href,
          }))}
        />
        {query.view === 'read' ? (
          <section aria-labelledby="read-heading" className={cardBox}>
            <h2 id="read-heading" className="sr-only">
              Read view
            </h2>
            <Byline view={view} />
            <p className="text-lg leading-normal">
              <SourceText segments={view.readSegments} />
            </p>
            <p className="text-sm text-ink-faint">
              {`Reads in about ${view.readClock}`}
            </p>
          </section>
        ) : null}
        {query.view === 'full' ? (
          <section aria-labelledby="full-heading" className={cardBox}>
            <h2 id="full-heading" className="sr-only">
              Full source
            </h2>
            <Byline view={view} />
            <p className="text-md leading-normal text-ink-muted">
              <SourceText segments={view.shown.segments} />
            </p>
            <SourceLegend />
          </section>
        ) : null}
        {query.view === 'read' || query.view === 'cite' ? (
          <Provenance view={view} />
        ) : null}
        <section aria-labelledby="cred-heading" className={cardBox}>
          <div className="flex items-center justify-between gap-3">
            <h2 id="cred-heading" className="text-md font-bold">
              Your credibility notes
            </h2>
            <span className="inline-flex items-center gap-1 text-xs text-ink-faint">
              <PrepIcon name="lock" size={14} />
              Stay private when shared
            </span>
          </div>
          <p className="text-base text-ink-muted">{card.credibilityNotes}</p>
        </section>
      </div>
      <aside
        aria-label="Library"
        className="flex w-rail shrink-0 flex-col gap-6 max-rail:w-full"
      >
        <section className="flex flex-col gap-3">
          <h2 className={heading}>Where it has been used</h2>
          {card.uses.length === 0 ? (
            <p className="text-sm text-ink-muted">Not used yet.</p>
          ) : (
            <ul className="flex flex-col">
              {card.uses.map((use) => (
                <li key={use.href}>
                  <Link
                    href={use.href}
                    className="flex min-h-12 flex-col justify-center no-underline hover:no-underline"
                  >
                    <span className="text-base font-strong">{use.title}</span>
                    <span className="text-sm text-ink-muted">{use.detail}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="flex flex-col gap-3">
          <h2 className={heading}>Version history</h2>
          <ul className="flex flex-col gap-3">
            {view.versionLinks.map((v) => (
              <li key={v.version} className="flex items-start gap-3">
                <span className="w-8 shrink-0 text-sm font-bold text-ink-muted">{`v${v.version}`}</span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-base font-strong">{v.label}</span>
                  <span className="text-sm text-ink-muted">{v.when}</span>
                </span>
                {v.current ? (
                  <Badge tone="accent">Current</Badge>
                ) : (
                  <Link href={v.href} className="text-sm font-strong">
                    View
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </section>
      </aside>
    </div>
  );
}
