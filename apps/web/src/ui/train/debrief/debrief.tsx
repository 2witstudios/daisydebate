import Link from 'next/link';
import {
  backToTrainHref,
  type DebriefQuery,
  type DebriefView,
} from '../../../features/train/debrief';
import { withPlanContext, type HubQuery } from '../../../features/train/query';
import {
  setupHref,
  type PracticeConfig,
} from '../../../features/train/practice';
import { Badge } from '../../components/badge/badge';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { FeedbackCard } from './feedback-card';
import { SaveCard } from './save-card';
import { SpeechesCard } from './speeches-card';
import { TrainPage } from '../train-page/train-page';

export type DebriefProps = {
  readonly view: DebriefView;
  readonly config: PracticeConfig;
  readonly plan: HubQuery;
  readonly query: DebriefQuery;
};

const link = 'no-underline hover:no-underline';

/**
 * The debrief: what the practice showed, notes per speech, what to work on,
 * arguments to save, and feedback on the session. Saving and sending are the
 * next step of the mock flow (a GET), not a stored change.
 */
export function Debrief({ view, config, plan, query }: DebriefProps) {
  return (
    <TrainPage>
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <h1 className="font-display text-3xl leading-tight font-bold tracking-tight max-compact:text-2xl">
            Debrief
          </h1>
          <p className="text-base text-ink-muted">{view.intro}</p>
        </div>
        <p className="flex items-center gap-2">
          <Badge tone="accent">Practice · Unrated</Badge>
          <Badge>Rating unchanged</Badge>
        </p>
      </header>
      {view.empty ? (
        <TrainCard title="No speeches yet">
          <p className="text-base text-ink-muted">
            You ended before your first speech, so there is nothing to review
            yet. Nothing was saved and your rating did not change.
          </p>
        </TrainCard>
      ) : (
        <>
          <ul className="grid grid-cols-3 gap-4 max-compact:grid-cols-1">
            {view.stats.map((stat) => (
              <li
                key={stat.label}
                className="flex flex-col gap-1 rounded-lg border border-border bg-surface p-5 shadow-1"
              >
                <span className="text-xs font-bold tracking-wider text-ink-faint uppercase">
                  {stat.label}
                </span>
                <span className="font-display text-3xl font-bold text-ink">
                  {stat.value}
                </span>
                <span className="text-sm text-ink-muted">{stat.detail}</span>
              </li>
            ))}
          </ul>
          <div className="grid grid-cols-2 gap-6 max-compact:grid-cols-1 max-compact:gap-4">
            <SpeechesCard
              view={view}
              config={config}
              plan={plan}
              query={query}
            />
            <div className="flex flex-col gap-4">
              {view.selected ? (
                <TrainCard title={view.selected.name}>
                  <p className="text-xs font-bold tracking-wider text-ink-faint uppercase">
                    Automated notes
                  </p>
                  <p className="text-base text-ink">{view.selected.note}</p>
                  <p className="rounded-md bg-surface-sunken p-3 text-base text-ink">
                    <b className="font-strong">Try next time.</b>{' '}
                    {view.selected.fix}
                  </p>
                </TrainCard>
              ) : null}
              <TrainCard title="Work on next">
                <ul className="flex flex-col gap-3">
                  {view.work.map((item) => (
                    <li
                      key={item.title}
                      className="flex items-center justify-between gap-3"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="text-base font-strong text-ink">
                          {item.title}
                        </span>
                        <span className="text-sm text-ink-muted">
                          {item.detail}
                        </span>
                      </span>
                      <Link
                        href={withPlanContext(item.href, plan)}
                        aria-label={`Drill: ${item.title}`}
                        className={cn(buttonClass('secondary'), link)}
                      >
                        Drill
                      </Link>
                    </li>
                  ))}
                </ul>
              </TrainCard>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-6 max-compact:grid-cols-1 max-compact:gap-4">
            <SaveCard view={view} config={config} plan={plan} query={query} />
            <FeedbackCard config={config} plan={plan} query={query} />
          </div>
        </>
      )}
      <div className="flex flex-wrap gap-3">
        <Link
          href={setupHref(config, plan)}
          className={cn(buttonClass('primary'), link)}
        >
          Practice again
        </Link>
        <Link
          href={backToTrainHref(plan, !view.empty)}
          className={cn(buttonClass('secondary'), link)}
        >
          Back to Train
        </Link>
      </div>
    </TrainPage>
  );
}
