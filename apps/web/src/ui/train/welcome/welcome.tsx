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
import { Icon, type IconName } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { CustomRulesBanner } from '../custom-rules-banner/custom-rules-banner';
import { TrainHeader } from '../header/train-header';
import { ModeCards } from '../mode-cards/mode-cards';
import { SavedCard } from '../saved-card/saved-card';
import { TrainColumns, TrainPage } from '../train-page/train-page';
import { WeekStrip } from '../week-card/week-strip';

export type TrainWelcomeProps = {
  /** The goal chosen so far, or 0 while none is. */
  readonly goal: WeeklyGoal | 0;
  readonly summary?: TrainingSummary;
};

const expectations: readonly (readonly [IconName, string])[] = [
  ['clock', 'Drills take five to ten minutes'],
  ['check', 'Practice debates are never rated'],
  ['calendar', 'You choose how much time you have each day'],
];

const goalClass = (selected: boolean) =>
  cn(
    'inline-flex min-h-10 min-w-10 items-center justify-center rounded-sm border px-3 text-base font-strong no-underline hover:no-underline',
    selected
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-border bg-surface-raised text-ink-muted',
  );

function Waiting({ title, children }: { title: string; children: string }) {
  return (
    <TrainCard title={title} level={3}>
      <p className="rounded-md bg-surface-sunken p-4 text-sm text-ink-muted">
        {children}
      </p>
    </TrainCard>
  );
}

/** The hub for an account that has never trained: one clear first step. */
export function TrainWelcome({
  goal,
  summary = emptySummary,
}: TrainWelcomeProps) {
  return (
    <TrainPage>
      <TrainHeader
        title="Train"
        lede="Practice arguments. Sharpen your mind."
      />
      <TrainColumns
        asideLabel="Training summary"
        main={
          <>
            <div className="grid grid-cols-dash-lower gap-6 max-compact:grid-cols-1 max-compact:gap-4">
              <section className="flex flex-col gap-4 rounded-lg border border-accent bg-accent-soft p-6 shadow-1">
                <h2 className="font-display text-2xl font-bold text-ink">
                  Start with one argument.
                </h2>
                <p className="text-base text-ink-muted">
                  Write a claim, a warrant and an impact. Daisy shows what is
                  missing. Revise it and save it. It becomes your first review
                  card.
                </p>
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
              <TrainCard title="What you will do here" level={3}>
                <ul className="flex flex-col gap-3">
                  {expectations.map(([icon, text]) => (
                    <li
                      key={text}
                      className="flex items-center gap-3 text-base text-ink"
                    >
                      <span className="text-accent">
                        <Icon name={icon} size={18} />
                      </span>
                      {text}
                    </li>
                  ))}
                </ul>
              </TrainCard>
            </div>
            <ModeCards cards={modeCards(summary, 'first')} />
            <div className="grid grid-cols-2 gap-4 max-compact:grid-cols-1">
              <Waiting title="Structure on the first check">
                After your first drill, your progress shows here.
              </Waiting>
              <Waiting title="Strongest and weakest parts">
                Claim, warrant, impact and responding appear after a few drills.
              </Waiting>
            </div>
            <CustomRulesBanner />
          </>
        }
        aside={
          <>
            <TrainCard title="This week">
              <WeekStrip trained={summary.week.days} />
              <p className="text-sm text-ink-muted">
                Pick a weekly goal. You can change it any time, and rest days
                count.
              </p>
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
            <p className="text-sm text-ink-faint">
              Training never changes your rating.
            </p>
          </>
        }
      />
    </TrainPage>
  );
}
