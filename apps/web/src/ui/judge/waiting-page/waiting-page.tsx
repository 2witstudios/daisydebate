import Link from 'next/link';
import type { WaitingView } from '../../../features/judge/flow';
import { judgeRoutes } from '../../../features/judge/routes';
import { buttonClass } from '../../components/button/button-class';
import { Icon } from '../../components/icon/icon';
import { Panel } from '../../components/panel/panel';
import { cn } from '../../cn';
import { BackLink } from '../back-link/back-link';
import { Notice } from '../../components/notice/notice';

export type WaitingPageProps = { readonly view: WaitingView };

const link = 'no-underline hover:no-underline';

function InPool({ view }: WaitingPageProps) {
  return (
    <section
      aria-label="Waiting for a round"
      className="flex flex-col gap-5 rounded-xl bg-surface-stage p-10 shadow-1 max-compact:p-5"
    >
      <p className="flex items-center gap-3 text-base font-bold text-stage-accent">
        <span
          aria-hidden="true"
          className="size-3 rounded-round bg-stage-accent"
        />
        In the judge pool
      </p>
      <h1 className="font-display text-3xl leading-tight font-bold text-stage-ink">
        Looking for a debate
      </h1>
      <dl className="flex flex-wrap gap-8">
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-stage-ink-muted">Waiting</dt>
          <dd className="font-display text-2xl font-bold text-stage-ink tabular-nums">
            {view.waited}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-sm text-stage-ink-muted">Offer window</dt>
          <dd className="font-display text-2xl font-bold text-stage-ink">
            {view.offerWindow}
          </dd>
        </div>
      </dl>
      <div className="flex flex-wrap items-center gap-3">
        <Link
          href={view.cancelHref}
          className={cn(
            buttonClass('secondary'),
            link,
            'border-stage-ink-muted text-stage-ink hover:border-stage-ink hover:text-stage-ink',
          )}
        >
          Cancel
        </Link>
      </div>
    </section>
  );
}

function Left({ view }: WaitingPageProps) {
  return (
    <section
      aria-label="You left the pool"
      className="flex flex-col items-start gap-4 rounded-xl bg-surface p-10 shadow-1 max-compact:p-5"
    >
      <span className="inline-flex size-12 items-center justify-center rounded-md bg-surface-overlay text-ink-muted">
        <Icon name="clock" size={22} />
      </span>
      <h1 className="font-display text-2xl font-bold">
        You left the judge pool
      </h1>
      <div className="flex flex-wrap gap-3">
        <Link
          href={view.restartHref}
          className={cn(buttonClass('primary'), link)}
        >
          Start judging
        </Link>
        <Link
          href={view.hubHref}
          className={cn(buttonClass('secondary'), link)}
        >
          Back to Judge
        </Link>
      </div>
    </section>
  );
}

/** Waiting in the judge pool, or the page after leaving it. */
export function WaitingPage({ view }: WaitingPageProps) {
  return (
    <div className="mx-auto flex w-full max-w-dash-column flex-col gap-6 px-6 pt-5 pb-8 max-compact:gap-4 max-compact:px-4">
      <BackLink />
      <div className="grid grid-cols-12 items-start gap-6 max-compact:grid-cols-1 max-compact:gap-4">
        <div className="col-span-7 max-compact:col-span-1">
          {view.step === 'waiting' ? (
            <InPool view={view} />
          ) : (
            <Left view={view} />
          )}
        </div>
        <div className="col-span-5 flex flex-col gap-4 max-compact:col-span-1">
          <Notice tone="accent" icon="bell" title="Keep this page open">
            Offers expire if you leave.
          </Notice>
          <Panel title="While you wait">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap gap-3">
                <Link
                  href={judgeRoutes.resources}
                  className={cn(buttonClass('secondary'), link)}
                >
                  Ballot criteria
                </Link>
                <Link
                  href={judgeRoutes.resources}
                  className={cn(buttonClass('secondary'), link)}
                >
                  Practice
                </Link>
              </div>
            </div>
          </Panel>
        </div>
      </div>
    </div>
  );
}
