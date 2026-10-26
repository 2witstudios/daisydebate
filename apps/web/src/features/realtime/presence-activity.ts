import { ENVELOPE_VERSION, type PresenceActivity } from '@daisy/protocol';

/**
 * A tab's last reported presence activity (ADR 0033 §1): one frame per
 * change while open, and, since a new server lease starts active, the
 * current one again on ready when it is not.
 */
export function createActivityReport(send: (frame: string) => void) {
  let activity: PresenceActivity = 'active';
  const frame = () =>
    JSON.stringify({
      v: ENVELOPE_VERSION,
      type: 'presence.activity',
      activity,
    });
  return {
    report(next: PresenceActivity, open: boolean) {
      if (next === activity) return;
      activity = next;
      if (open) send(frame());
    },
    ready() {
      if (activity !== 'active') send(frame());
    },
  };
}
