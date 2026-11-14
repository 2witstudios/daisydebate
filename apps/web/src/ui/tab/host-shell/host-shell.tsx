import { Suspense, type ReactNode } from 'react';
import type { TimelineRail as Rail } from '../../../features/tab/tournament';
import { SampleActionNotice } from '../../components/sample-action/sample-action-notice';
import { TimelineRail } from './timeline-rail';

/**
 * The host area's own shell: the timeline rail beside one page. It owns the
 * page's single main landmark, and the sample-action banner sits above every
 * page, as it does in the product shell.
 */
export function HostShell({
  rail,
  current,
  aside,
  asideLabel,
  children,
}: {
  readonly rail: Rail;
  readonly current: string | null;
  /** A panel beside the page: one fixture, one role, one event. */
  readonly aside?: ReactNode;
  readonly asideLabel?: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen bg-background text-ink max-compact:flex-col">
      <TimelineRail rail={rail} current={current} />
      <main className="min-w-0 flex-1 px-10 py-8 max-compact:px-4 max-compact:py-5">
        <div className="mx-auto flex max-w-host-column flex-col gap-5">
          <Suspense fallback={null}>
            <SampleActionNotice />
          </Suspense>
          {aside === undefined ? (
            children
          ) : (
            <div className="flex items-start gap-6 max-rail:flex-col">
              <div className="flex min-w-0 flex-1 flex-col gap-5 max-rail:w-full">
                {children}
              </div>
              <aside
                aria-label={asideLabel}
                className="flex w-host-aside shrink-0 flex-col gap-4 rounded-lg border border-border bg-surface-raised p-5 max-rail:w-full"
              >
                {aside}
              </aside>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
