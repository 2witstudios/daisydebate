'use client';
import { useBrowserEffect } from '../edge/browser-sync';
import { browserFetch } from '../edge/browser-request';
import { startTick, stopTick } from '../edge/browser-time';
import { useRef, useState } from 'react';
import { systemId } from '@daisy/clock';
import { isDebatingSeat, type RoundView } from '@daisy/protocol';
import { createAttendanceHttpClient } from '../../features/attendance/http-client';
import {
  ATTENDANCE_HEARTBEAT_MS,
  createAttendanceClient,
} from '../../features/attendance/client';

/**
 * HTTP receipt production is independent of realtime, visibility and
 * microphone permission. Returns whether check-in stopped because the
 * session is gone, so the Round can say sign in again.
 */
export function useRoundAttendance({
  view,
  actorId,
  reconnect: reconnectSource,
}: {
  readonly view: RoundView;
  readonly actorId: string;
  readonly reconnect?: {
    readonly subscribe: (listener: () => void) => () => void;
  };
}): { readonly signedOut: boolean } {
  const eligible = view.participants.some(
    (seat) =>
      'actorId' in seat &&
      seat.actorId === actorId &&
      seat.kind === 'human' &&
      isDebatingSeat(seat.seat),
  );
  // Keyed by the client that hit the 401 (its Round and eligibility): a new
  // client, such as the Room's next Round, shows no stale signed-out state.
  const clientKey = `${view.id}:${eligible}`;
  const [signedOutKey, setSignedOutKey] = useState<string | null>(null);
  const client = useRef<ReturnType<typeof createAttendanceClient> | null>(null);
  useBrowserEffect(() => {
    if (!eligible) return;
    const key = `${view.id}:${eligible}`;
    const http = createAttendanceHttpClient({
      roundId: view.id,
      fetch: (url, init) => browserFetch(url, init),
      timeout: (ms) => AbortSignal.timeout(ms),
    });
    const consumer = createAttendanceClient({
      nextCommandId: () => systemId.next(),
      nowMs: () => performance.now(),
      read: http.read,
      send: http.send,
      signedOut: () => setSignedOutKey(key),
    });
    client.current = consumer;
    const reconnect = () => {
      void consumer.reconnect();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') reconnect();
    };
    window.addEventListener('online', reconnect);
    const unsubscribe = reconnectSource?.subscribe(reconnect);
    document.addEventListener('visibilitychange', visible);
    const timer = startTick(() => {
      void consumer.heartbeat();
    }, ATTENDANCE_HEARTBEAT_MS);
    return () => {
      client.current = null;
      consumer.stop();
      unsubscribe?.();
      stopTick(timer);
      window.removeEventListener('online', reconnect);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [view.id, eligible, reconnectSource]);
  useBrowserEffect(() => {
    void client.current?.update(view);
  }, [view, eligible]);
  return { signedOut: signedOutKey === clientKey };
}
