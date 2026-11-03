import type { RuntimeCheckpoint } from '@daisy/protocol';
import { roundIncidentNotice } from '../../features/round-incidents/notice';

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
      data-round-incident
      className="rounded-md bg-surface-overlay px-4 py-3 font-strong"
    >
      {/* Announced once: a count that changes each second is not read aloud each second. */}
      <span role="status">{notice.held}</span>
      {notice.resumesInSeconds === null
        ? null
        : ` Resuming in ${notice.resumesInSeconds} s.`}
    </p>
  );
}
