import Link from 'next/link';
import { trainDestinations } from '../../../features/train/actions';
import type { TrainingSummary } from '../../../features/train/summary';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';

/** The account's saved custom rule sets, always unrated. */
export function RuleSetsCard({
  summary,
}: {
  readonly summary: TrainingSummary;
}) {
  return (
    <TrainCard title="Your rule sets">
      <ul className="flex flex-col gap-3">
        {summary.ruleSets.map((set) => (
          <li
            key={set.id}
            className="flex items-center justify-between gap-2 text-base text-ink"
          >
            {set.name}
            <Badge>Unrated</Badge>
          </li>
        ))}
      </ul>
      <Link
        href={trainDestinations.customRules}
        className={cn(
          buttonClass('secondary'),
          'no-underline hover:no-underline',
        )}
      >
        Practice with custom rules
      </Link>
    </TrainCard>
  );
}
