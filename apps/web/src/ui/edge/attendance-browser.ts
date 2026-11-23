import { systemId } from '@daisy/clock';
import { createAttendanceHttpClient } from '../../features/attendance/http-client';
import {
  ATTENDANCE_HEARTBEAT_MS,
  createAttendanceClient,
} from '../../features/attendance/client';
import { browserTransport } from './browser-request';
import { browserScheduler } from './browser-time';

export type BrowserAttendance = ReturnType<typeof createAttendanceClient> & {
  readonly dispose: () => void;
};

/**
 * A Round's check-in in this tab: the attendance client over the browser's
 * transport, its heartbeat, and the reconnects that coming back online, the
 * tab being shown again or the caller's own source ask for. Disposing stops
 * the client first, then every binding.
 */
export function openBrowserAttendance(input: {
  readonly roundId: string;
  readonly signedOut: () => void;
  readonly reconnect?: {
    readonly subscribe: (listener: () => void) => () => void;
  };
}): BrowserAttendance {
  const http = createAttendanceHttpClient({
    roundId: input.roundId,
    fetch: browserTransport,
    timeout: (ms) => AbortSignal.timeout(ms),
  });
  const consumer = createAttendanceClient({
    nextCommandId: () => systemId.next(),
    nowMs: () => performance.now(),
    read: http.read,
    send: http.send,
    signedOut: input.signedOut,
  });
  const reconnect = () => {
    void consumer.reconnect();
  };
  const visible = () => {
    if (document.visibilityState === 'visible') reconnect();
  };
  window.addEventListener('online', reconnect);
  const unsubscribe = input.reconnect?.subscribe(reconnect);
  document.addEventListener('visibilitychange', visible);
  const stopHeartbeat = browserScheduler.every(() => {
    void consumer.heartbeat();
  }, ATTENDANCE_HEARTBEAT_MS);
  return {
    ...consumer,
    dispose: () => {
      consumer.stop();
      unsubscribe?.();
      stopHeartbeat();
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', visible);
    },
  };
}
