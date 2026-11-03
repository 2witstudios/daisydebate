import {
  reasonsForTarget,
  type ContentReportTargetKind,
} from '@daisy/protocol';
import { reportReasonLabels } from '../../features/content-moderation/report-labels';

/**
 * Report a thing, with a closed reason. A native post under a closed details
 * element, so it needs no script and stays out of the way until wanted.
 */
export function ReportForm({
  targetKind,
  targetId,
  label,
  action,
}: {
  readonly targetKind: ContentReportTargetKind;
  readonly targetId: string;
  readonly label: string;
  readonly action: (form: FormData) => void | Promise<void>;
}) {
  return (
    <details className="text-sm text-ink-muted">
      <summary className="cursor-pointer font-semibold">{label}</summary>
      <form action={action} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="targetKind" value={targetKind} />
        <input type="hidden" name="targetId" value={targetId} />
        <label className="flex flex-col gap-1">
          Reason
          <select name="reason" required>
            {reasonsForTarget(targetKind).map((reason) => (
              <option key={reason} value={reason}>
                {reportReasonLabels[reason]}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className="font-strong">
          Send report
        </button>
      </form>
    </details>
  );
}
