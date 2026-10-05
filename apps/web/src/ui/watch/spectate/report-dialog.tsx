import Link from 'next/link';
import { reportReasons } from '../../../features/watch/report';
import type { SpectateQuery } from '../../../features/watch/spectate-query';
import { spectateHref } from '../../../features/watch/spectate-query';
import { buttonClass } from '../../components/button/button-class';
import { cn } from '../../cn';
import { InertButton } from '../inert-button/inert-button';

export type ReportDialogProps = {
  readonly id: string;
  readonly query: SpectateQuery;
  /** What is being reported, resolved for display. */
  readonly target: string;
};

/**
 * The report dialog: open because the URL says so, closed by a link, so it
 * needs no script. Sending is inert until the moderation service exists.
 */
export function ReportDialog({ id, query, target }: ReportDialogProps) {
  const close = spectateHref(id, { ...query, report: null });
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim/60 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        className="flex w-full max-w-search flex-col gap-4 rounded-xl bg-surface-raised p-6 shadow-3"
      >
        <div className="flex items-start justify-between gap-4">
          <h2
            id="report-title"
            className="font-display text-xl font-bold tracking-tight text-ink"
          >
            {`Report ${target}`}
          </h2>
          <Link href={close} aria-label="Close" className="text-ink-muted">
            Close
          </Link>
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-sm font-strong text-ink">Reason</legend>
          {reportReasons.map((reason, index) => (
            <label
              key={reason.id}
              className="flex items-center gap-2 text-base text-ink"
            >
              <input
                type="radio"
                name="report-reason"
                value={reason.id}
                defaultChecked={index === 0}
              />
              {reason.label}
            </label>
          ))}
        </fieldset>
        <div className="flex flex-col gap-1">
          <label htmlFor="report-note" className="text-sm font-strong text-ink">
            Details (optional)
          </label>
          <textarea
            id="report-note"
            rows={3}
            placeholder="What happened, and when?"
            className="rounded-md border border-border bg-surface px-3 py-2 text-base text-ink placeholder:text-ink-faint"
          />
        </div>
        <p className="text-sm text-ink-muted">Only moderators see reports.</p>
        <div className="flex justify-end gap-3">
          <Link
            href={close}
            className={cn(
              buttonClass('secondary'),
              'no-underline hover:no-underline',
            )}
          >
            Cancel
          </Link>
          <InertButton action="report" variant="primary">
            Send report
          </InertButton>
        </div>
      </div>
    </div>
  );
}
