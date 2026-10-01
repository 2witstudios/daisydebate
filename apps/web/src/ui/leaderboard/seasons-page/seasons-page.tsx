import Link from 'next/link';
import { rangeBars } from '../../../features/leaderboard/explainer';
import { bloomLabel } from '../../../features/leaderboard/bloom';
import {
  displayName,
  ratingText,
  recordText,
} from '../../../features/leaderboard/labels';
import { PROVISIONAL_AFTER } from '../../../features/leaderboard/standing';
import type { SeasonsView } from '../../../features/leaderboard/seasons';
import { Badge } from '../../components/badge/badge';
import { BloomGlyph } from '../bloom-glyph/bloom-glyph';
import { LadderRow } from '../ladder-row/ladder-row';
import { LadderHeading } from '../ladder-row/ladder-heading';
import { Segmented } from '../segmented/segmented';
import { cn } from '../../cn';

export type SeasonsPageProps = { readonly view: SeasonsView };

const card = 'flex flex-col gap-3 rounded-lg bg-surface p-5 shadow-1';
const eyebrow = 'text-2xs font-bold tracking-wider text-ink-faint uppercase';
const openLadder = 'text-base font-strong';

const howItWorks: readonly { title: string; body: string }[] = [
  {
    title: 'Every ranked debate is a rating period',
    body: 'Win or lose, your rating moves after each ranked debate. Beating a higher-rated debater moves it more.',
  },
  {
    title: 'Rating comes with a range',
    body: 'Daisy also tracks how sure it is of your rating. The range narrows as you play and widens if you are away.',
  },
  {
    title: 'Provisional until the range settles',
    body: `New debaters are provisional until they have played ${PROVISIONAL_AFTER} ranked debates. They are not ranked until then.`,
  },
  {
    title: 'One ladder per season',
    body: 'Every ranked debate runs on the standard rules, so a rating means the same thing for everyone. A new season starts a new ladder.',
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

/** One season at a glance: dates, champion, a top-ten snapshot, and how rating works. */
export function SeasonsPage({ view }: SeasonsPageProps) {
  const champion = view.champion;
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-5 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            Seasons
          </h1>
          <p className="text-base text-ink-muted">
            One ladder, renewed every season.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="neutral">Sample data</Badge>
          <Segmented label="Season" segments={view.chips} />
        </div>
      </header>
      <section className={card}>
        <Badge tone={view.closed ? 'gold' : 'accent'}>{view.tag}</Badge>
        <h2 className="font-display text-2xl font-bold">{view.label}</h2>
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
          <BloomGlyph bloom={champion.bloom} size={44} />
          <div className="flex min-w-0 flex-1 flex-col">
            <span
              className={eyebrow}
            >{`${view.championLabel} · ${view.tag}`}</span>
            <span className="truncate font-display text-xl font-bold">
              {displayName(champion)}
            </span>
            <span className="text-sm text-ink-muted tabular-nums">
              {`${ratingText(champion)} · ${recordText(champion)} W–L · ${bloomLabel(champion.bloom)}`}
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
        <LadderHeading closed={view.closed} />
        <ul>
          {view.snapshot.map((row) => (
            <LadderRow key={row.key} row={row} closed={view.closed} />
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
          <p className="text-sm text-ink-muted">
            A rating is a best guess with a range around it. Provisional ratings
            move quickly because the range is wide. Sample ranges shown.
          </p>
          <RangePicture />
          <p className="text-xs text-ink-faint">
            Hollow marker: provisional. Filled marker: established.
          </p>
        </section>
      </div>
    </div>
  );
}
