import {
  formatRating,
  progressLine,
  ratingProgress,
  statusLabel,
  type JudgeRating,
} from '../../../features/judge/rating';
import { Badge } from '../../components/badge/badge';
import { Panel } from '../../components/panel/panel';
import { BackLink } from '../back-link/back-link';
import { Notice } from '../notice/notice';
import { PageHeader } from '../../components/page-header/page-header';
import { ProgressBar } from '../progress-bar/progress-bar';
import { RatingChart } from './rating-chart';
import { RecentBallots } from './recent-ballots';

export type RatingPageProps = { readonly rating: JudgeRating };

const moves: readonly {
  readonly title: string;
  readonly body: string;
  readonly tag: 'Moves rating' | 'Context only';
}[] = [
  {
    title: 'Debater feedback on your reasons',
    body: 'Debaters mark a reason helpful or not helpful, with an optional comment. This is the main input.',
    tag: 'Moves rating',
  },
  {
    title: 'Review outcomes',
    body: 'A review can leave your ballot standing, or void it for a conflict or a reason that contradicts its decision.',
    tag: 'Moves rating',
  },
  {
    title: 'Agreement with the panel',
    body: 'Shown for context only. Disagreeing with the other judges, or with who won, never lowers your rating.',
    tag: 'Context only',
  },
];

/** The judge's own rating, what moves it, and the ballots behind it. */
export function RatingPage({ rating }: RatingPageProps) {
  const established = rating.status === 'established';
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <BackLink />
      <PageHeader
        title="Your judge rating"
        lede="One rating, like a player’s rating. Private to you, and separate from your player rating."
      />
      <div className="grid grid-cols-12 items-start gap-6 max-compact:grid-cols-1 max-compact:gap-4">
        <div className="col-span-6 flex flex-col gap-4 max-compact:col-span-1">
          <section
            aria-label="Judge rating"
            className="flex flex-col gap-4 rounded-xl bg-surface p-6 shadow-1"
          >
            <div className="flex flex-wrap items-end justify-between gap-4">
              <div className="flex flex-col gap-1">
                <span className="text-base text-ink-muted">{`Judge rating · ${rating.season.toLowerCase()}`}</span>
                <span className="font-display text-display-sm leading-none font-bold tabular-nums">
                  {formatRating(rating.rating)}
                </span>
              </div>
              <Badge tone={established ? 'accent' : 'gold'}>
                {statusLabel(rating.status)}
              </Badge>
            </div>
            <RatingChart series={rating.series} />
            <div className="flex flex-col gap-2">
              <ProgressBar
                percent={ratingProgress(rating)}
                tone="accent"
                label="Progress to an established rating"
              />
              <p className="text-base text-ink-muted">{`${progressLine(rating)}${established ? '' : '.'}`}</p>
            </div>
          </section>
          <Panel title="What moves your rating">
            <ul className="flex flex-col">
              {moves.map(({ title, body, tag }) => (
                <li
                  key={title}
                  className="flex items-center gap-4 border-t border-border py-3 first:border-t-0 first:pt-0 last:pb-0"
                >
                  <div className="flex min-w-0 grow flex-col gap-1">
                    <p className="text-md font-strong">{title}</p>
                    <p className="text-sm leading-normal text-ink-muted">
                      {body}
                    </p>
                  </div>
                  <Badge tone={tag === 'Moves rating' ? 'accent' : 'neutral'}>
                    {tag}
                  </Badge>
                </li>
              ))}
            </ul>
          </Panel>
        </div>
        <div className="col-span-6 flex flex-col gap-4 max-compact:col-span-1">
          <RecentBallots ballots={rating.recent} />
          <Notice tone="gold" icon="alert" title="Design assumption">
            The owner has not defined judge rating. This shows one plausible
            model. Weights, the ballot threshold and the rating scale are
            placeholders, and the rating is private to you.
          </Notice>
        </div>
      </div>
    </div>
  );
}
