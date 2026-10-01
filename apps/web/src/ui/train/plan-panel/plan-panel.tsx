import Link from 'next/link';
import type { PlanRow } from '../../../features/train/hub';
import { trainDestinations } from '../../../features/train/actions';
import { planMinutes } from '../../../features/train/plan';
import {
  hubHref,
  withPlanContext,
  type HubQuery,
} from '../../../features/train/query';
import { buttonClass } from '../../components/button/button-class';
import { Icon, type IconName } from '../../components/icon/icon';
import { cn } from '../../cn';
import { TrainCard } from '../card/train-card';
import { IconChip } from '../icon-chip/icon-chip';

export type PlanPanelProps = {
  readonly stage: 'plan' | 'done';
  /** Tomorrow's review, shown once the plan is done. */
  readonly dueTomorrow: number;
  readonly plan: readonly PlanRow[];
  readonly totalMinutes: number;
  readonly query: HubQuery;
};

const icons: Readonly<Record<PlanRow['kind'], IconName>> = {
  review: 'clock',
  drill: 'bolt',
  practice: 'swords',
};

const link = 'no-underline hover:no-underline';

const choiceClass = (selected: boolean) =>
  cn(
    'inline-flex min-h-10 items-center rounded-sm border px-4 text-base font-strong no-underline hover:no-underline',
    selected
      ? 'border-accent bg-accent-soft text-accent'
      : 'border-border bg-surface-raised text-ink-muted',
  );

/** Today's plan: pick the time you have, then work the rows in order. */
export function PlanPanel({
  stage,
  dueTomorrow,
  plan,
  totalMinutes,
  query,
}: PlanPanelProps) {
  const done = stage === 'done';
  return (
    <TrainCard title="Today's plan">
      {done ? (
        <p className="text-sm text-ink-muted">
          You finished today&apos;s plan. Nothing else is due.
        </p>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-ink-muted">
            {`About ${totalMinutes} minutes. Pick how long you have.`}
          </p>
          <nav aria-label="Time available">
            <ul className="flex gap-2">
              {planMinutes.map((mins) => (
                <li key={mins}>
                  <Link
                    href={hubHref({ ...query, mins })}
                    className={choiceClass(query.mins === mins)}
                    aria-current={query.mins === mins ? 'true' : undefined}
                  >
                    {`${mins} min`}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      )}
      <ol className="flex flex-col">
        {plan.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center gap-4 border-t border-border py-3 first:border-t-0"
          >
            {row.done ? (
              <span
                className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent text-accent-ink"
                aria-hidden="true"
              >
                <Icon name="check" size={20} />
              </span>
            ) : (
              <IconChip name={icons[row.kind]} />
            )}
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="text-md font-strong text-ink">{row.title}</span>
              <span className="text-sm text-ink-muted">
                {row.done ? row.doneMeta : row.meta}
              </span>
            </div>
            <span className="text-sm text-ink-faint tabular-nums">{`${row.minutes} min`}</span>
            {row.done ? (
              <span className="text-sm font-strong text-accent">Done</span>
            ) : (
              <Link
                href={withPlanContext(row.href, query)}
                className={cn(buttonClass('primary'), link)}
                aria-label={`${row.cta}: ${row.title}`}
              >
                {row.cta}
              </Link>
            )}
          </li>
        ))}
      </ol>
      {done ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <p className="flex flex-col text-sm text-ink-muted">
            <span className="text-base font-strong text-ink">
              Next review: tomorrow
            </span>
            {`${dueTomorrow} ${dueTomorrow === 1 ? 'argument' : 'arguments'} due. The queue is never more than you set.`}
          </p>
          <Link
            href={trainDestinations.practice}
            className={cn(buttonClass('secondary'), link)}
          >
            Practice a debate anyway
          </Link>
        </div>
      ) : null}
    </TrainCard>
  );
}
