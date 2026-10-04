import Link from 'next/link';
import {
  formatRating,
  progressLine,
  ratingProgress,
  statusLabel,
  type JudgeRating,
} from '../../../features/judge/rating';
import { judgeRoutes } from '../../../features/judge/routes';
import { Badge } from '../../components/badge/badge';
import { ProgressBar } from '../progress-bar/progress-bar';

export type RatingCardProps = { readonly rating: JudgeRating };

/** The hub's summary of the judge's private rating. */
export function RatingCard({ rating }: RatingCardProps) {
  return (
    <section
      aria-label="Your judge rating"
      className="overflow-hidden rounded-xl bg-surface shadow-1"
    >
      <div className="flex flex-col gap-4 p-5">
        <h2 className="text-xl font-bold">Your judge rating</h2>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="flex flex-col gap-1">
            <span className="text-base text-ink-muted">{rating.season}</span>
            <span className="font-display text-display-sm leading-none font-bold tabular-nums">
              {formatRating(rating.rating)}
            </span>
          </div>
          <Badge tone={rating.status === 'established' ? 'accent' : 'gold'}>
            {statusLabel(rating.status)}
          </Badge>
        </div>
        <div className="flex flex-col gap-2">
          <ProgressBar
            percent={ratingProgress(rating)}
            tone={rating.status === 'established' ? 'accent' : 'gold'}
            label="Progress to an established rating"
          />
          <p className="text-base text-ink-muted">{progressLine(rating)}</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-5 py-2">
        <span className="text-sm text-ink-faint">Private to you</span>
        <Link
          href={judgeRoutes.rating}
          className="inline-flex min-h-12 items-center gap-2 text-md font-strong text-accent no-underline hover:no-underline"
        >
          Rating and recent ballots
          <span aria-hidden="true">→</span>
        </Link>
      </div>
    </section>
  );
}
