import {
  weekGoalMet,
  weekSessions,
  type TrainingSummary,
} from '../../../features/train/summary';
import { TrainCard } from '../card/train-card';
import { InertButton } from '../inert-button/inert-button';
import { WeekStrip } from './week-strip';

/** This week's sessions against the goal; rest days never count against it. */
export function WeekCard({ summary }: { readonly summary: TrainingSummary }) {
  const { week } = summary;
  return (
    <TrainCard title="This week">
      <WeekStrip trained={week.days} />
      <p className="text-base text-ink">
        <b className="font-strong">{`${weekSessions(summary)} of ${week.goal} sessions`}</b>
        {weekGoalMet(summary) ? ': goal met.' : '.'}
      </p>
      <p className="text-sm text-ink-muted">
        Rest days count. Missing a day resets nothing.
      </p>
      <div className="flex items-center justify-between gap-2 text-sm text-ink-muted">
        <span>{`Practiced ${week.practicedDaysLast30} of the last 30 days`}</span>
        <InertButton>Change goal</InertButton>
      </div>
    </TrainCard>
  );
}
