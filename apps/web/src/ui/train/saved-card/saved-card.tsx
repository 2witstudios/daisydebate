import Link from 'next/link';
import { trainDestinations } from '../../../features/train/actions';
import type { TrainingSummary } from '../../../features/train/summary';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';

const link = 'no-underline hover:no-underline';

/** The saved-argument library: how many, how many due, or none yet. */
export function SavedCard({ summary }: { readonly summary: TrainingSummary }) {
  const { saved } = summary;
  if (saved.total === 0)
    return (
      <TrainCard title="Saved arguments">
        <p className="text-sm text-ink-muted">
          None yet. Save arguments from drills and from practice debriefs, and
          they come back here to review.
        </p>
      </TrainCard>
    );
  return (
    <TrainCard title="Saved arguments">
      <p className="flex items-baseline gap-2 text-sm text-ink-muted">
        <span className="font-display text-2xl font-bold text-ink">
          {saved.total}
        </span>
        {`saved, ${saved.due} due today`}
      </p>
      <Link
        href={trainDestinations.review}
        className={cn(buttonClass('secondary'), link)}
      >
        Open library
      </Link>
    </TrainCard>
  );
}
