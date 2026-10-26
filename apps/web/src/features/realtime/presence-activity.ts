import { ENVELOPE_VERSION, type PresenceActivity } from '@daisy/protocol';

/**
 * A tab's last reported presence activity (ADR 0033 §1, ADR 0072). Only a
 * connection that reports presence sends it: the current activity on every
 * ready, which is what starts the server's lease, then one frame per change
 * while open. Any other connection never sends one, so it never keeps its
 * member online.
 */
export function createActivityReport(
  send: (frame: string) => void,
  reporting: boolean,
) {
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
      if (open && reporting) send(frame());
    },
    ready() {
      if (reporting) send(frame());
    },
  };
}
