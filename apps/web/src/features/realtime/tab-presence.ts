import type { PresenceActivity } from '@daisy/protocol';
import type { ConnectionStore } from './connection-types';
import { startPresenceBeacon } from './presence-beacon';

type Reporting = Pick<ConnectionStore, 'reportActivity'>;
type BeaconEdges = Omit<Parameters<typeof startPresenceBeacon>[0], 'report'>;

/**
 * One tab's presence (ADR 0072): every realtime connection the tab opens
 * attaches here and reports the same activity, from one activity source that
 * runs while any connection is attached. A hidden or quiet tab therefore
 * goes idle on all of its sockets at once.
 */
export function createTabPresence(edges: BeaconEdges) {
  const connections = new Set<Reporting>();
  const listeners = new Set<() => void>();
  let current: PresenceActivity = 'active';
  let stopBeacon: (() => void) | null = null;
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const report = (activity: PresenceActivity) => {
    current = activity;
    for (const connection of connections) connection.reportActivity(activity);
  };
  return {
    /** Joins the tab's activity; the returned detach leaves it. */
    attach(connection: Reporting): () => void {
      connections.add(connection);
      connection.reportActivity(current);
      stopBeacon ??= startPresenceBeacon({ ...edges, report });
      notify();
      return () => {
        if (!connections.delete(connection)) return;
        if (connections.size === 0) {
          stopBeacon?.();
          stopBeacon = null;
        }
        notify();
      };
    },
    /** How many connections the tab holds now. */
    size: () => connections.size,
    /** Calls back whenever a connection attaches or detaches. */
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
export type TabPresence = ReturnType<typeof createTabPresence>;

/**
 * Holds a presence connection open only while the tab has no other: a page
 * that opens its own (a conversation, a room) carries the tab's presence,
 * so the shell closes its socket rather than double the tab's connections,
 * and opens it again once the page's closes.
 */
export function keepPresenceConnection(
  tab: Pick<TabPresence, 'size' | 'subscribe'>,
  open: () => Pick<ConnectionStore, 'connect' | 'close'>,
): () => void {
  let own: Pick<ConnectionStore, 'connect' | 'close'> | null = null;
  let syncing = false;
  const sync = () => {
    if (syncing) return;
    syncing = true;
    try {
      const others = tab.size() - (own ? 1 : 0);
      if (others === 0 && !own) {
        own = open();
        own.connect();
      } else if (others > 0 && own) {
        const closing = own;
        own = null;
        closing.close();
      }
    } finally {
      syncing = false;
    }
  };
  const unsubscribe = tab.subscribe(sync);
  sync();
  return () => {
    unsubscribe();
    const closing = own;
    own = null;
    closing?.close();
  };
}
