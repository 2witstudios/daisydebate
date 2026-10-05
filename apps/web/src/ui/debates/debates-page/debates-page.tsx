import Link from 'next/link';
import {
  debatesHref,
  endedLabel,
  judgeLine,
  resultHref,
  tabs,
  type DebatesListing,
  type DebatesQuery,
  type MyDebate,
  type Tab,
} from '../../../features/debates/list';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import { TabLinks } from '../../components/tab-links/tab-links';
import { cn } from '../../cn';

const linkButton = 'no-underline hover:no-underline';

const tabLabel: Readonly<Record<Tab, string>> = {
  all: 'All',
  won: 'Wins',
  lost: 'Losses',
  ranked: 'Ranked',
  practice: 'Practice',
};

const resultBadge = {
  won: { tone: 'accent', label: 'Won' },
  lost: { tone: 'neutral', label: 'Lost' },
  draw: { tone: 'gold', label: 'Draw' },
} as const;

const change = (value: number): string =>
  value > 0 ? `+${value}` : `${value}`;

function Row({
  debate,
  now,
}: {
  readonly debate: MyDebate;
  readonly now: string;
}) {
  const badge = resultBadge[debate.result];
  return (
    <li className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-lg border border-border bg-surface p-5 shadow-1">
      <div className="flex min-w-0 flex-col gap-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={resultHref(debate)}
            className="text-md font-strong text-ink no-underline hover:underline"
          >
            {debate.title}
          </Link>
          <Badge tone={debate.mode === 'ranked' ? 'gold' : 'neutral'}>
            {debate.mode === 'ranked' ? 'Ranked' : 'Practice'}
          </Badge>
        </div>
        <p className="text-sm text-ink-muted">
          {`${endedLabel(debate.endedAt, now)} · ${
            debate.side === 'affirmative' ? 'Affirmative' : 'Negative'
          } against @${debate.opponent} · ${judgeLine(debate.judge)}`}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone={badge.tone}>{badge.label}</Badge>
        {debate.ratingChange === null ? null : (
          <span className="text-base font-strong text-ink tabular-nums">
            {change(debate.ratingChange)}
          </span>
        )}
        <Link
          href={resultHref(debate)}
          className={cn(buttonClass('ghost'), linkButton)}
        >
          Result
        </Link>
        {debate.recordingId ? (
          <Link
            href={`/recordings/${debate.recordingId}`}
            className={cn(buttonClass('ghost'), linkButton)}
          >
            Recording
          </Link>
        ) : null}
      </div>
    </li>
  );
}

/** Your finished debates: the result, the judge and what it did to your rating. */
export function DebatesPage({
  listing,
  query,
  now,
}: {
  readonly listing: DebatesListing;
  readonly query: DebatesQuery;
  readonly now: string;
}) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <PageHeader
        title="My debates"
        actions={
          <Link href="/play" className={cn(buttonClass('primary'), linkButton)}>
            Open a practice room
          </Link>
        }
      />
      <TabLinks
        label="Filter debates"
        tabs={tabs.map((tab) => ({
          id: tab,
          label: tabLabel[tab],
          href: debatesHref({ tab, page: 1 }),
          selected: tab === query.tab,
          count: listing.counts[tab],
        }))}
      />
      {listing.rows.length === 0 ? (
        <section
          aria-label="No debates"
          className="flex flex-col items-start gap-3 rounded-xl bg-surface p-6 shadow-1"
        >
          <h2 className="font-display text-xl font-bold text-ink">
            No debates here yet
          </h2>
          <Link
            href="/lobby"
            className={cn(buttonClass('secondary'), linkButton)}
          >
            Go to the lobby
          </Link>
        </section>
      ) : (
        <ul aria-label="Debates" className="flex flex-col gap-3">
          {listing.rows.map((debate) => (
            <Row key={debate.id} debate={debate} now={now} />
          ))}
        </ul>
      )}
      {listing.pageCount > 1 ? (
        <nav
          aria-label="Pages"
          className="flex items-center justify-between gap-4"
        >
          {listing.page > 1 ? (
            <Link
              href={debatesHref({ ...query, page: listing.page - 1 })}
              rel="prev"
              className={cn(buttonClass('secondary'), linkButton)}
            >
              Previous
            </Link>
          ) : (
            <span aria-disabled="true" className="text-base text-ink-faint">
              Previous
            </span>
          )}
          <span className="text-sm text-ink-muted">{`Page ${listing.page} of ${listing.pageCount}`}</span>
          {listing.page < listing.pageCount ? (
            <Link
              href={debatesHref({ ...query, page: listing.page + 1 })}
              rel="next"
              className={cn(buttonClass('secondary'), linkButton)}
            >
              Next
            </Link>
          ) : (
            <span aria-disabled="true" className="text-base text-ink-faint">
              Next
            </span>
          )}
        </nav>
      ) : null}
    </div>
  );
}
