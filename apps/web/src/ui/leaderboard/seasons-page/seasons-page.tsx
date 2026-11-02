import Link from 'next/link';
import { rangeBars } from '../../../features/leaderboard/explainer';
import {
  displayName,
  ratingText,
  recordText,
} from '../../../features/leaderboard/labels';
import type { SeasonsView } from '../../../features/leaderboard/seasons';
import type { PublishedResolution } from '@daisy/protocol';
import { Badge } from '../../components/badge/badge';
import { LadderRow } from '../ladder-row/ladder-row';
import { PublishedResolutions } from '../published-resolutions/published-resolutions';
import { LadderHeading } from '../ladder-row/ladder-heading';
import { Segmented } from '../segmented/segmented';
import { seasonsCardClass, seasonsEyebrowClass } from './seasons-class';
import { cn } from '../../cn';

export type SeasonsPageProps = {
  /** Null when no season has opened. */
  readonly view: SeasonsView | null;
  /** Empty when this view does not list them; see listsPublishedResolutions. */
  readonly resolutions: readonly PublishedResolution[];
};

const openLadder = 'text-base font-strong';
const frame =
  'mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4';
const title =
  'font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl';

function NoActiveSeason() {
  return <p className="text-base text-ink-muted">No season is active.</p>;
}

const howItWorks: readonly { title: string; body: string }[] = [
  {
    title: 'Every ranked debate counts',
    body: 'Beating a higher-rated debater moves your rating more.',
  },
  {
    title: 'Rating comes with a range',
    body: 'It narrows as you play and widens while you are away.',
  },
  {
    title: 'Provisional until the range settles',
    body: 'Provisional while rating deviation is above 110.',
  },
  {
    title: 'Three ladders per season',
    body: 'A new season starts a new ladder.',
  },
];

const PICTURE_WIDTH = 400;

function RangePicture() {
  return (
    <svg
      viewBox="0 0 400 100"
      role="img"
      aria-label="A provisional rating has a wide range; an established rating has a narrow one."
      className="w-full"
    >
      {rangeBars(PICTURE_WIDTH).map((bar) => (
        <g key={bar.key}>
          <line
            x1={bar.x1}
            x2={bar.x2}
            y1={bar.y}
            y2={bar.y}
            strokeWidth="8"
            strokeLinecap="round"
            className="stroke-accent-soft"
          />
          <circle
            cx={bar.dot}
            cy={bar.y}
            r="6"
            strokeWidth="2"
            className={
              bar.key === 'provisional'
                ? 'fill-surface stroke-ink-faint'
                : 'fill-accent stroke-accent'
            }
          />
          <text x={bar.x1} y={bar.y - 12} className="fill-ink-muted text-2xs">
            {bar.label}
          </text>
        </g>
      ))}
    </svg>
  );
}

/**
 * One season at a glance: dates, champion, a top-ten snapshot, and how rating
 * works, with the current published resolutions beside it, which are not the
 * season's (ADR 0092). With no season at all, the resolutions alone.
 */
export function SeasonsPage({ view, resolutions }: SeasonsPageProps) {
  if (view === null)
    return (
      <div className={frame}>
        <h1 className={title}>Seasons</h1>
        <NoActiveSeason />
        <PublishedResolutions resolutions={resolutions} />
      </div>
    );
  const closed = view.state !== 'running';
  const champion = view.champion;
  return (
    <div className={frame}>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <h1 className={title}>Seasons</h1>
        <Segmented label="Season" segments={view.chips} />
      </header>
      {view.state === 'none-active' ? <NoActiveSeason /> : null}
      <PublishedResolutions resolutions={resolutions} />
      <section className={card}>
        <Badge tone={closed ? 'gold' : 'accent'}>{view.tag}</Badge>
        <h2 className="font-display text-2xl font-bold">
          {view.ladderLabel} · {view.label}
        </h2>
        <p className="text-base text-ink-muted">{view.dates}</p>
        <progress
          value={view.percent}
          max={100}
          aria-label="Season progress"
          className="h-2 w-full accent-accent"
        />
        <p className="text-sm text-ink-muted">{view.statusLine}</p>
      </section>
      {champion ? (
        <section
          aria-label={view.championLabel}
          className={cn(card, 'flex-row items-center gap-4')}
        >
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={eyebrow}
            >{`${view.championLabel} · ${view.tag}`}</span>
            <span className="truncate font-display text-xl font-bold">
              {displayName(champion)}
            </span>
            <span className="text-sm text-ink-muted tabular-nums">
              {`${ratingText(champion)} · ${recordText(champion)} W–L`}
            </span>
          </div>
          <Link href={view.ladderHref} className={openLadder}>
            Open the full ladder
          </Link>
        </section>
      ) : null}
      <section
        aria-label={view.snapshotTitle}
        className="overflow-hidden rounded-lg border border-border bg-surface shadow-1"
      >
        <div className="flex items-baseline justify-between gap-3 px-5 py-4">
          <h2 className="text-lg font-bold">{view.snapshotTitle}</h2>
          <span className="text-sm text-ink-faint">{`${view.label} · top ${view.snapshot.length}`}</span>
        </div>
        <LadderHeading closed={closed} />
        <ul>
          {view.snapshot.map((row) => (
            <LadderRow key={row.key} row={row} closed={closed} />
          ))}
        </ul>
        <div className="border-t border-border px-5 py-3">
          <Link href={view.ladderHref} className={openLadder}>
            Open the full ladder
          </Link>
        </div>
      </section>
      <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
        <section id="how-rating-works" className={card}>
          <h2 className={eyebrow}>How rating works</h2>
          <ul className="flex flex-col gap-3">
            {howItWorks.map((item) => (
              <li key={item.title} className="flex flex-col">
                <span className="font-strong">{item.title}</span>
                <span className="text-sm text-ink-muted">{item.body}</span>
              </li>
            ))}
          </ul>
        </section>
        <section className={card}>
          <h2 className={eyebrow}>Provisional and established</h2>
          <RangePicture />
          <p className="text-xs text-ink-faint">
            Hollow marker: provisional. Filled marker: established.
          </p>
        </section>
      </div>
    </div>
  );
}
