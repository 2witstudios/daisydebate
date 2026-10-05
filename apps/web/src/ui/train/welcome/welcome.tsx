import Link from 'next/link';
import { trainDestinations } from '../../../features/train/actions';
import { drillHref } from '../../../features/train/plan';
import { modeCards } from '../../../features/train/modes';
import { weeklyGoals, type WeeklyGoal } from '../../../features/train/query';
import {
  emptySummary,
  type TrainingSummary,
} from '../../../features/train/summary';
import { buttonClass } from '../../components/button/button-class';
import { PageHeader } from '../../components/page-header/page-header';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { CustomRulesBanner } from '../custom-rules-banner/custom-rules-banner';
import { ModeCards } from '../mode-cards/mode-cards';
import { SavedCard } from '../saved-card/saved-card';
import { TrainColumns, TrainPage } from '../train-page/train-page';
import { WeekStrip } from '../week-card/week-strip';

export type TrainWelcomeProps = {
  /** The goal chosen so far, or 0 while none is. */
  readonly goal: WeeklyGoal | 0;
  readonly summary?: TrainingSummary;
};

const goalClass = (selected: boolean) =>
  cn(
    'inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm border px-3 text-base font-strong no-underline hover:no-underline',
    selected
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-border bg-surface-raised text-ink-muted',
  );

/** The hub for an account that has never trained: one clear first step. */
export function TrainWelcome({
  goal,
  summary = emptySummary,
}: TrainWelcomeProps) {
  return (
    <TrainPage>
      <PageHeader title="Train" />
      <TrainColumns
        asideLabel="Training summary"
        main={
          <>
            <section className="flex flex-col gap-4 rounded-lg border border-accent bg-accent-soft p-6 shadow-1">
              <h2 className="font-display text-2xl font-bold text-ink">
                Start with one argument.
              </h2>
              <div>
                <Link
                  href={drillHref('impact')}
                  className={cn(
                    buttonClass('primary'),
                    'no-underline hover:no-underline',
                  )}
                >
                  Start your first drill
                </Link>
              </div>
            </section>
            <ModeCards cards={modeCards(summary, 'first')} />
            <CustomRulesBanner />
          </>
        }
        aside={
          <>
            <TrainCard title="This week">
              <WeekStrip trained={summary.week.days} />
              <p className="text-sm text-ink-muted">Sessions a week</p>
              <nav aria-label="Sessions a week">
                <ul className="flex items-center gap-2">
                  {weeklyGoals.map((count) => (
                    <li key={count}>
                      <Link
                        href={`${trainDestinations.welcome}?goal=${count}`}
                        className={goalClass(goal === count)}
                        aria-current={goal === count ? 'true' : undefined}
                        aria-label={`${count} ${count === 1 ? 'session' : 'sessions'} a week`}
                      >
                        {count}
                      </Link>
                    </li>
                  ))}
                </ul>
              </nav>
            </TrainCard>
            <SavedCard summary={summary} />
          </>
        }
      />
    </TrainPage>
  );
}
