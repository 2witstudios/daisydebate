import type { BrowserScheduler } from '../edge/browser-time';
import {
  createConversationRecovery,
  type ConversationRecoveryOrigin,
} from './conversation-recovery';
import { createRefreshSettlement } from './refresh-settlement';

/**
 * How long a refresh may go without a recorded read before it is taken as
 * settled. Longer than any wait the recovery schedules (10 s at most).
 */
const REFRESH_READ_LIMIT_MS = 30_000;

/** What the reconnecting page shows: only whether recovery gave up. */
export type ConversationReconnectingSnapshot = {
  readonly exhausted: boolean;
};

/**
 * One temporarily refused conversation page's recovery: at most three
 * sequential fresh reads of the page it was mounted on, each after the
 * refusal's doubling wait, each counted settled once its route read has
 * arrived and the refresh transition has ended. The page hands it what the
 * browser says (renders, route reads, leaving); it asks for refreshes.
 */
export function createConversationReconnectingDriver(ports: {
  /** The tab's address now; recovery belongs to the address it began on. */
  readonly address: () => string;
  /** Re-reads the page from the server (the router's refresh, in a transition). */
  readonly refresh: () => void;
  readonly scheduler: Pick<BrowserScheduler, 'after'>;
}) {
  const address = ports.address();
  const pathname = new URL(address).pathname;
  const listeners = new Set<() => void>();
  let snapshot: ConversationReconnectingSnapshot = { exhausted: false };
  const recovery = createConversationRecovery({
    refresh: () => {
      if (ports.address() !== address) {
        recovery.stop();
        return;
      }
      settlement.asked();
      ports.refresh();
    },
    schedule: ports.scheduler.after,
    exhausted: () => {
      snapshot = { exhausted: true };
      for (const listener of listeners) listener();
    },
  });
  const settlement = createRefreshSettlement({
    wait: ports.scheduler.after,
    limitMs: REFRESH_READ_LIMIT_MS,
    settled: () => recovery.settled(),
  });
  return {
    readSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    /** A settled render of the refused page: its answer and the wait it asks for. */
    refused: (
      requestId: string,
      retryAfterMs: number,
      origin: ConversationRecoveryOrigin,
    ) => recovery.refused(requestId, retryAfterMs, origin),
    /** A route read has finished arriving; only this page's counts. */
    readFinished: (url: URL) => {
      if (url.pathname === pathname) settlement.readFinished();
    },
    /** Whether the refresh transition is running, as last rendered. */
    transitionRan: (running: boolean) => settlement.transitionRan(running),
    /** The member is leaving this page: nothing more is refreshed. */
    stop: () => recovery.stop(),
    dispose() {
      settlement.dispose();
      recovery.stop();
      listeners.clear();
    },
  };
}
