import type { RuntimeCheckpoint } from '@daisy/protocol';
import { roundIncidentNotice } from '../../features/round-runtime/round-incident-notice';

/** Why the Round stopped and when it runs again, for everyone in the room. */
export function RoundIncidentBanner({
  checkpoint,
  nowMs,
}: {
  readonly checkpoint: RuntimeCheckpoint | null;
  readonly nowMs: number;
}) {
  const notice = roundIncidentNotice(checkpoint, nowMs);
  if (!notice) return null;
  return (
    <p
      role="status"
      data-round-incident
      className="rounded-md bg-surface-overlay px-4 py-3 font-strong"
    >
      {notice.held}
      {notice.resumesInSeconds === null
        ? null
        : ` Resuming in ${notice.resumesInSeconds} s.`}
    </p>
  );
}
